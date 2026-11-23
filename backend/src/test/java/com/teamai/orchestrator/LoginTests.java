package com.teamai.orchestrator;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

class LoginTests extends AuthApiTestSupport {
    @Autowired JwtDecoder decoder;
    @Autowired com.teamai.orchestrator.core.persistence.UserRepository users;
    @Autowired com.teamai.orchestrator.core.persistence.RefreshSessionStore sessions;
    @Autowired org.springframework.transaction.support.TransactionTemplate transactions;
    @Autowired java.time.Clock clock;
    String register() throws Exception {
        String email = UUID.randomUUID() + "@example.test";
        assertEquals(201, mvc.perform(registration(body(email), csrf())).andReturn().getResponse().getStatus());
        return email;
    }
    org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder login(String email, String password, Csrf csrf) throws Exception {
        return post("/api/v1/auth/login").secure(true).header("Origin", ORIGIN).cookie(csrf.cookie())
                .header("X-CSRF-Token", csrf.token()).contentType("application/json")
                .content(json.writeValueAsString(Map.of("email", email, "password", password)));
    }
    @Test void loginIssuesJwtAndOnlyDigestPersistsWithAbsoluteFamilyExpiry() throws Exception {
        String email = register();
        var response = mvc.perform(login(email.toUpperCase(Locale.ROOT), PASSWORD, csrf())).andReturn().getResponse();
        assertEquals(200, response.getStatus(), response.getContentAsString());
        assertEquals("no-store", response.getHeader("Cache-Control"));
        var body = json.readTree(response.getContentAsString());
        assertEquals(4, body.size());
        var token = decoder.decode(body.get("accessToken").asString());
        assertEquals(Duration.ofSeconds(900), Duration.between(token.getIssuedAt(), token.getExpiresAt()));
        assertFalse(token.hasClaim("roles")); assertEquals("Bearer", body.get("tokenType").asString());
        var cookie = response.getCookie("refresh_token");
        assertNotNull(cookie); assertTrue(cookie.getSecure()); assertTrue(cookie.isHttpOnly());
        assertEquals("Lax", cookie.getAttribute("SameSite")); assertNull(cookie.getDomain());
        assertEquals("/api/v1/auth", cookie.getPath()); assertTrue(cookie.getMaxAge() > 604790 && cookie.getMaxAge() <= 604800);
        assertEquals(32, Base64.getUrlDecoder().decode(cookie.getValue()).length);
        assertFalse(response.getContentAsString().contains(cookie.getValue()));
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(cookie.getValue().getBytes(StandardCharsets.US_ASCII));
        var row = jdbc.queryForMap("""
                select s.token_hash, s.consumed_at, s.revoked_at, s.replacement_id,
                       extract(epoch from (f.expires_at - f.issued_at)) as lifetime
                from refresh_sessions s join refresh_token_families f on f.id = s.family_id where f.user_id = ?
                """, UUID.fromString(token.getSubject()));
        assertArrayEquals(digest, (byte[])row.get("token_hash"));
        assertEquals(604800L, ((Number)row.get("lifetime")).longValue());
        assertNull(row.get("consumed_at")); assertNull(row.get("revoked_at")); assertNull(row.get("replacement_id"));
        assertEquals(0, response.getCookie("csrf_token").getMaxAge());
        assertEquals(200, mvc.perform(get("/api/v1/users/me").header("Authorization", "Bearer " + token.getTokenValue())).andReturn().getResponse().getStatus());
        assertEquals(401, mvc.perform(get("/api/v1/users/me").cookie(cookie)).andReturn().getResponse().getStatus());
        jdbc.update("update users set is_active = false where id = ?", UUID.fromString(token.getSubject()));
        assertEquals(401, mvc.perform(get("/api/v1/users/me").header("Authorization", "Bearer " + token.getTokenValue())).andReturn().getResponse().getStatus());
    }
    @Test void invalidUnknownAndDisabledAreIndistinguishableAndCreateNoSessions() throws Exception {
        String active = register(), disabled = register();
        jdbc.update("update users set is_active = false where email = ?", disabled);
        long count = jdbc.queryForObject("select count(*) from refresh_sessions", Long.class);
        var cases = List.of(Map.entry(active, "incorrect"), Map.entry(UUID.randomUUID()+"@example.test", PASSWORD), Map.entry(disabled, PASSWORD));
        var csrf = csrf();
        for (var input : cases) {
            var response = mvc.perform(login(input.getKey(), input.getValue(), csrf)).andReturn().getResponse();
            assertEquals(401, response.getStatus());
            assertEquals("INVALID_CREDENTIALS", json.readTree(response.getContentAsString()).get("code").asString());
            assertNull(response.getCookie("refresh_token"));
        }
        assertEquals(count, jdbc.queryForObject("select count(*) from refresh_sessions", Long.class));
    }
    @Test void loginRequiresOriginAndRealCsrf() throws Exception {
        String email = register(); var csrf = csrf();
        for (String origin : List.of("", "null", "https://foreign.example.test")) {
            var request = login(email, PASSWORD, csrf); request.headers(h -> h.remove("Origin"));
            if (!origin.isEmpty()) request.header("Origin", origin);
            assertEquals(403, mvc.perform(request).andReturn().getResponse().getStatus());
        }
        assertEquals(403, mvc.perform(login(email, PASSWORD, new Csrf(csrf.cookie(), "wrong"))).andReturn().getResponse().getStatus());
        assertEquals(403, mvc.perform(post("/api/v1/auth/login").header("Origin", ORIGIN).contentType("application/json")
                .content(json.writeValueAsString(Map.of("email", email, "password", PASSWORD)))).andReturn().getResponse().getStatus());
        assertEquals(0, jdbc.queryForObject("select count(*) from refresh_token_families f join users u on u.id=f.user_id where u.email=?", Integer.class, email));
    }
    @Test void signingFailureRollsBackBothRefreshRows() throws Exception {
        String email = register();
        long families = jdbc.queryForObject("select count(*) from refresh_token_families", Long.class);
        long tokens = jdbc.queryForObject("select count(*) from refresh_sessions", Long.class);
        var signer = org.mockito.Mockito.mock(com.teamai.orchestrator.infrastructure.security.AccessTokenIssuer.class);
        org.mockito.Mockito.when(signer.issue(org.mockito.ArgumentMatchers.any())).thenThrow(new IllegalStateException("Synthetic signer failure"));
        var service = new com.teamai.orchestrator.core.application.LoginService(users, sessions, passwords, signer, transactions, clock);
        assertThrows(IllegalStateException.class, () -> service.login(new com.teamai.orchestrator.core.api.LoginRequest(email, PASSWORD)));
        assertEquals(families, jdbc.queryForObject("select count(*) from refresh_token_families", Long.class));
        assertEquals(tokens, jdbc.queryForObject("select count(*) from refresh_sessions", Long.class));
    }
    @Test void eachLoginHasIndependentFamilyAndRandomCredential() throws Exception {
        String email = register(); var csrf = csrf();
        var first = mvc.perform(login(email, PASSWORD, csrf)).andReturn().getResponse();
        var second = mvc.perform(login(email, PASSWORD, csrf())).andReturn().getResponse();
        assertEquals(200, first.getStatus()); assertEquals(200, second.getStatus());
        assertNotEquals(first.getCookie("refresh_token").getValue(), second.getCookie("refresh_token").getValue());
        assertEquals(2, jdbc.queryForObject("select count(*) from refresh_token_families f join users u on u.id=f.user_id where u.email=?", Integer.class, email));
    }
    @Test void invalidLoginInputAndAccountRateLimit() throws Exception {
        String email = UUID.randomUUID() + "@example.test"; var csrf = csrf();
        assertEquals(400, mvc.perform(login(email, "", csrf)).andReturn().getResponse().getStatus());
        assertEquals(400, mvc.perform(login("invalid", PASSWORD, csrf)).andReturn().getResponse().getStatus());
        assertEquals(400, mvc.perform(login(email, "🔐".repeat(129), csrf)).andReturn().getResponse().getStatus());
        for (int i = 0; i < 5; i++) assertEquals(401, mvc.perform(login(email, "x", csrf)).andReturn().getResponse().getStatus());
        var limited = mvc.perform(login(email, "x", csrf)).andReturn().getResponse();
        assertEquals(429, limited.getStatus()); assertNotNull(limited.getHeader("Retry-After"));
        assertEquals("RATE_LIMITED", json.readTree(limited.getContentAsString()).get("code").asString());
    }
}

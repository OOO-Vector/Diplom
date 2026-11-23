package com.teamai.orchestrator;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.ObjectMapper;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

class RegistrationTests extends AuthApiTestSupport {
    @Test void registerRateLimitPreventsSixthInsert() throws Exception {
        var csrf = csrf();
        for (int i = 0; i < 6; i++) {
            var response = mvc.perform(registration(body(UUID.randomUUID()+"@example.test"), csrf)
                    .with(request -> { request.setRemoteAddr("192.0.2.99"); return request; })).andReturn().getResponse();
            assertEquals(i < 5 ? 201 : 429, response.getStatus());
        }
    }
    @Test void registersSafeUserAndHashesExactPassword() throws Exception {
        String email = UUID.randomUUID() + "@example.test";
        var response = mvc.perform(registration(body(" " + email + " "), csrf())).andReturn().getResponse();
        assertEquals(201, response.getStatus(), response.getContentAsString());
        var user = json.readTree(response.getContentAsString());
        assertEquals(6, user.size()); assertFalse(user.has("passwordHash")); assertFalse(user.has("password"));
        assertEquals(email, user.get("email").asString()); assertEquals("Example", user.get("displayName").asString());
        assertNull(response.getCookie("refresh_token"));
        String hash = jdbc.queryForObject("select password_hash from users where email = ?", String.class, email);
        assertTrue(hash.startsWith("$argon2id$v=19$m=19456,t=2,p=1$"));
        assertTrue(passwords.matches(PASSWORD, hash)); assertFalse(passwords.matches(PASSWORD.strip(), hash));
    }
    @Test void rejectsInvalidInputAndUnknownFields() throws Exception {
        var csrf = csrf();
        for (var change : List.of(Map.of("email", "bad"), Map.of("displayName", "   "), Map.of("password", "short"),
                Map.of("password", "x".repeat(129)), Map.of("isActive", "true"))) {
            var request = new HashMap<>(body(UUID.randomUUID() + "@example.test")); request.putAll(change);
            assertEquals(400, mvc.perform(registration(request, csrf)).andReturn().getResponse().getStatus());
        }
        var unicode = new HashMap<>(body(UUID.randomUUID() + "@example.test"));
        unicode.put("password", "🔐".repeat(128));
        assertEquals(201, mvc.perform(registration(unicode, csrf)).andReturn().getResponse().getStatus());
        unicode.put("password", "🔐".repeat(129));
        assertEquals(400, mvc.perform(registration(unicode, csrf)).andReturn().getResponse().getStatus());
    }
    @Test void duplicateEmailIsCaseInsensitiveAndConcurrent() throws Exception {
        String email = UUID.randomUUID() + "@example.test";
        var csrf = csrf();
        var ready = new CyclicBarrier(2);
        try (var pool = Executors.newFixedThreadPool(2)) {
            List<Future<Integer>> results = new ArrayList<>();
            for (String variant : List.of(email, email.toUpperCase(Locale.ROOT))) {
                results.add(pool.submit(() -> { ready.await(10, TimeUnit.SECONDS);
                    return mvc.perform(registration(body(variant), csrf)).andReturn().getResponse().getStatus(); }));
            }
            var statuses = new ArrayList<Integer>();
            for (var result : results) statuses.add(result.get(30, TimeUnit.SECONDS));
            Collections.sort(statuses); assertEquals(List.of(201, 409), statuses);
        }
        assertEquals(1, jdbc.queryForObject("select count(*) from users where lower(email) = lower(?)", Integer.class, email));
        assertEquals(409, mvc.perform(registration(body(email), csrf)).andReturn().getResponse().getStatus());
    }
    @Test void strictOriginAndCsrfRejectBeforePersistence() throws Exception {
        String email = UUID.randomUUID() + "@example.test";
        var csrf = csrf();
        for (String origin : List.of("", "null", "https://foreign.example.test")) {
            var request = registration(body(email), csrf); request.headers(headers -> headers.remove("Origin"));
            if (!origin.isEmpty()) request.header("Origin", origin);
            var response = mvc.perform(request).andReturn().getResponse();
            assertEquals(403, response.getStatus()); assertEquals("no-store", response.getHeader("Cache-Control"));
        }
        var missing = post("/api/v1/auth/register").header("Origin", ORIGIN).contentType("application/json").content(json.writeValueAsString(body(email)));
        assertEquals(403, mvc.perform(missing).andReturn().getResponse().getStatus());
        assertEquals(403, mvc.perform(registration(body(email), new Csrf(csrf.cookie(), "wrong"))).andReturn().getResponse().getStatus());
        assertEquals(0, jdbc.queryForObject("select count(*) from users where email = ?", Integer.class, email));
    }
    @Test void meRequiresAuthenticatedActiveUser() throws Exception {
        String email = UUID.randomUUID() + "@example.test";
        var response = mvc.perform(registration(body(email), csrf())).andReturn().getResponse();
        String id = json.readTree(response.getContentAsString()).get("id").asString();
        assertEquals(401, mvc.perform(get("/api/v1/users/me")).andReturn().getResponse().getStatus());
        String token = tokens.issue(UUID.fromString(id));
        assertEquals(200, mvc.perform(get("/api/v1/users/me").header("Authorization", "Bearer " + token)).andReturn().getResponse().getStatus());
        jdbc.update("update users set is_active = false where id = ?", UUID.fromString(id));
        assertEquals(401, mvc.perform(get("/api/v1/users/me").header("Authorization", "Bearer " + token)).andReturn().getResponse().getStatus());
        assertEquals(401, mvc.perform(get("/api/v1/users/me").header("Authorization", "Bearer " + tokens.issue(UUID.randomUUID()))).andReturn().getResponse().getStatus());
        assertEquals(401, mvc.perform(get("/api/v1/users/me").header("Authorization", "Bearer broken")).andReturn().getResponse().getStatus());
    }
    @Test void rejectsOversizedBodiesAndJsonTypeCoercion() throws Exception {
        var csrf = csrf();
        var request = registration(body(UUID.randomUUID()+"@example.test"), csrf);
        request.content("{\"email\":\"numeric-password@example.test\",\"displayName\":\"Example\",\"password\":123456789012}");
        assertEquals(400, mvc.perform(request).andReturn().getResponse().getStatus());
        request.content(" ".repeat(16 * 1024 + 1));
        var response = mvc.perform(request).andReturn().getResponse();
        assertEquals(413, response.getStatus()); assertEquals("no-store", response.getHeader("Cache-Control"));
    }
    @Test void csrfRequiresMaskedHeaderAndCorsIsExact() throws Exception {
        var csrf = csrf();
        assertEquals(403, mvc.perform(registration(body(UUID.randomUUID()+"@example.test"),
                new Csrf(csrf.cookie(), csrf.cookie().getValue()))).andReturn().getResponse().getStatus());
        var allowed = mvc.perform(options("/api/v1/auth/login").header("Origin", ORIGIN)
                .header("Access-Control-Request-Method", "POST").header("Access-Control-Request-Headers", "X-CSRF-Token,Content-Type"))
                .andReturn().getResponse();
        assertEquals(200, allowed.getStatus()); assertEquals(ORIGIN, allowed.getHeader("Access-Control-Allow-Origin"));
        assertEquals("true", allowed.getHeader("Access-Control-Allow-Credentials"));
        var forbidden = mvc.perform(options("/api/v1/auth/login").header("Origin", "https://foreign.example.test")
                .header("Access-Control-Request-Method", "POST")).andReturn().getResponse();
        assertEquals(403, forbidden.getStatus()); assertEquals("no-store", forbidden.getHeader("Cache-Control"));
    }
}

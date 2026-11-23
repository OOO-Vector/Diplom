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

@SpringBootTest
class RegistrationTests extends PostgresTestSupport {
    static final String ORIGIN = "https://app.example.test";
    static final String PASSWORD = " synthetic fixture password ";
    @Autowired WebApplicationContext context;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwords;
    MockMvc mvc;
    @BeforeEach void setup() { mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build(); }

    record Csrf(Cookie cookie, String token) {}
    Csrf csrf() throws Exception {
        var response = mvc.perform(get("/api/v1/auth/csrf").secure(true)).andReturn().getResponse();
        assertEquals(200, response.getStatus());
        assertEquals("no-store", response.getHeader("Cache-Control"));
        var cookie = response.getCookie("csrf_token");
        assertTrue(cookie.isHttpOnly()); assertTrue(cookie.getSecure());
        assertEquals("/api/v1/auth", cookie.getPath());
        assertEquals("Lax", cookie.getAttribute("SameSite"));
        return new Csrf(cookie, json.readTree(response.getContentAsString()).get("token").asString());
    }
    Map<String, String> body(String email) { return Map.of("email", email, "displayName", " Example ", "password", PASSWORD); }
    MockHttpServletRequestBuilder registration(Map<String, String> body, Csrf csrf) throws Exception {
        return post("/api/v1/auth/register").secure(true).header("Origin", ORIGIN)
                .cookie(csrf.cookie()).header("X-CSRF-Token", csrf.token())
                .contentType("application/json").content(json.writeValueAsString(body));
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
        assertEquals(200, mvc.perform(get("/api/v1/users/me").with(user(id))).andReturn().getResponse().getStatus());
        jdbc.update("update users set is_active = false where id = ?", UUID.fromString(id));
        assertEquals(401, mvc.perform(get("/api/v1/users/me").with(user(id))).andReturn().getResponse().getStatus());
    }
}

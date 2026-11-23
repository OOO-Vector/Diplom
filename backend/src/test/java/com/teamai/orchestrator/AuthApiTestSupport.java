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
abstract class AuthApiTestSupport extends PostgresTestSupport {
    static final String ORIGIN = "https://app.example.test";
    static final String PASSWORD = " synthetic fixture password ";
    @Autowired WebApplicationContext context;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwords;
    @Autowired com.teamai.orchestrator.infrastructure.security.AccessTokenIssuer tokens;
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
                .with(request -> { request.setRemoteAddr("2001:db8:" + UUID.randomUUID()); return request; })
                .cookie(csrf.cookie()).header("X-CSRF-Token", csrf.token())
                .contentType("application/json").content(json.writeValueAsString(body));
    }
}

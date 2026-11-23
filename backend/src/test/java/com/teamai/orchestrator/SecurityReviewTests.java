package com.teamai.orchestrator;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.security.web.csrf.CsrfFilter;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

class SecurityReviewTests extends AuthApiTestSupport {
    @Autowired FilterChainProxy security;

    @Test void onlyBearerResourceChainExcludesCsrfAndStillRequiresAuthentication() throws Exception {
        assertTrue(security.getFilters("/api/v1/users/me").stream().noneMatch(CsrfFilter.class::isInstance));
        assertTrue(security.getFilters("/api/v1/auth/login").stream().anyMatch(CsrfFilter.class::isInstance));
        // No CSRF rejection masks authentication on an unsafe resource request. No write route is added.
        var response = mvc.perform(post("/api/v1/users/me")).andReturn().getResponse();
        assertEquals(401, response.getStatus());
        assertEquals("Bearer", response.getHeader("WWW-Authenticate"));
    }

    @Test void authPostsStillRequireBothCsrfAndStrictOrigin() throws Exception {
        var csrf = csrf();
        for (String route : java.util.List.of("register", "login", "refresh", "logout")) {
            var path = "/api/v1/auth/" + route;
            assertEquals(403, mvc.perform(post(path).header("Origin", ORIGIN)).andReturn().getResponse().getStatus());
            for (String origin : java.util.List.of("", "null", "https://foreign.example.test")) {
                var request = post(path).cookie(csrf.cookie()).header("X-CSRF-Token", csrf.token());
                if (!origin.isEmpty()) request.header("Origin", origin);
                var response = mvc.perform(request).andReturn().getResponse();
                assertEquals(403, response.getStatus());
                assertEquals("no-store", response.getHeader("Cache-Control"));
            }
        }
    }
}

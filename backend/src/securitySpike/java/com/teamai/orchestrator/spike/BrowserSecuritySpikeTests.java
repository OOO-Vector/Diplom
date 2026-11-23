package com.teamai.orchestrator.spike;

import java.util.List;
import java.util.Map;
import java.security.KeyPair;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.ResponseCookie;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.*;
import org.springframework.test.context.junit.jupiter.web.SpringJUnitWebConfig;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.cors.*;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

// Stub endpoints demonstrate filters/cookies only. They do not authenticate users or persist sessions.
@SpringJUnitWebConfig(BrowserSecuritySpikeTests.Config.class)
class BrowserSecuritySpikeTests {
    static final String ORIGIN = "https://app.example.test";
    static final String AUTH = "/api/v1/auth";
    @Autowired WebApplicationContext context;
    @Autowired KeyPair keys;
    MockMvc mvc;

    @BeforeEach void setup() {
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Configuration(proxyBeanMethods = false)
    @EnableWebMvc
    @EnableWebSecurity
    static class Config {
        @Bean KeyPair keys() throws Exception { return CryptoSpikeTests.keyPair(); }
        @Bean JwtDecoder decoder(KeyPair keys) { return CryptoSpikeTests.decoder(keys); }
        @Bean CookieCsrfTokenRepository csrfRepository() {
            var repository = new CookieCsrfTokenRepository();
            repository.setCookieName("csrf_token");
            repository.setHeaderName("X-CSRF-Token");
            repository.setCookiePath(AUTH);
            repository.setCookieCustomizer(cookie -> cookie.httpOnly(true).secure(true).sameSite("Lax"));
            return repository;
        }
        @Bean ProbeController controller(CookieCsrfTokenRepository repository) {
            return new ProbeController(repository);
        }
        @Bean SecurityFilterChain chain(HttpSecurity http, CookieCsrfTokenRepository repository) throws Exception {
            var cors = new CorsConfiguration();
            cors.setAllowedOrigins(List.of(ORIGIN));
            cors.setAllowCredentials(true);
            cors.setAllowedMethods(List.of("GET", "POST", "OPTIONS"));
            cors.setAllowedHeaders(List.of("Content-Type", "Authorization", "X-CSRF-Token"));
            var source = new UrlBasedCorsConfigurationSource();
            source.registerCorsConfiguration("/**", cors);
            http.cors(config -> config.configurationSource(source))
                .sessionManagement(config -> config.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(config -> config.disable())
                .formLogin(config -> config.disable()).httpBasic(config -> config.disable())
                .logout(config -> config.disable())
                .csrf(config -> config.csrfTokenRepository(repository)
                        .csrfTokenRequestHandler(new XorCsrfTokenRequestAttributeHandler())
                        .requireCsrfProtectionMatcher(request -> request.getMethod().equals("POST")
                                && List.of(AUTH + "/register", AUTH + "/login", AUTH + "/refresh", AUTH + "/logout")
                                .contains(request.getRequestURI())))
                .authorizeHttpRequests(config -> config
                        .requestMatchers(AUTH + "/**").permitAll()
                        .requestMatchers("/api/v1/users/me", "/api/v1/spike/bearer").authenticated()
                        .anyRequest().denyAll())
                .oauth2ResourceServer(config -> config.jwt(jwt -> {}));
            // CORS alone does not reject missing Origin or every same-origin POST.
            // Proposed browser-only policy: exact configured Origin is mandatory on auth POST.
            http.addFilterBefore(new OncePerRequestFilter() {
                @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                        jakarta.servlet.FilterChain chain) throws java.io.IOException, jakarta.servlet.ServletException {
                    if (request.getRequestURI().startsWith(AUTH + "/")) {
                        response.setHeader("Cache-Control", "no-store");
                        if (request.getMethod().equals("POST") && !ORIGIN.equals(request.getHeader("Origin"))) {
                            response.sendError(403);
                            return;
                        }
                    }
                    chain.doFilter(request, response);
                }
            }, org.springframework.web.filter.CorsFilter.class);
            return http.build();
        }
    }

    @RestController
    static class ProbeController {
        final CookieCsrfTokenRepository repository;
        ProbeController(CookieCsrfTokenRepository repository) { this.repository = repository; }
        @GetMapping(AUTH + "/csrf") Map<String, String> csrf(CsrfToken token) {
            return Map.of("headerName", token.getHeaderName(), "token", token.getToken());
        }
        @PostMapping({AUTH + "/register", AUTH + "/login", AUTH + "/refresh", AUTH + "/logout"})
        void probe(HttpServletRequest request, HttpServletResponse response) {
            boolean logout = request.getRequestURI().endsWith("/logout");
            if (logout || request.getRequestURI().endsWith("/login")) {
                repository.saveToken(null, request, response);
            }
            if (!request.getRequestURI().endsWith("/register")) {
                response.addHeader("Set-Cookie", ResponseCookie.from("refresh_token", logout ? "" : "synthetic-probe-only")
                        .httpOnly(true).secure(true).sameSite("Lax").path(AUTH)
                        .maxAge(logout ? 0 : 604800).build().toString());
            }
            response.setStatus(204);
        }
        @GetMapping("/api/v1/users/me") Map<String, String> me() { return Map.of("probe", "bearer-filter-only"); }
        @PostMapping("/api/v1/spike/bearer") void bearer(HttpServletResponse response) { response.setStatus(204); }
    }

    record Bootstrap(Cookie cookie, String token) {}
    Bootstrap bootstrap() throws Exception {
        MvcResult result = mvc.perform(get(AUTH + "/csrf").secure(true))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("headerName").value("X-CSRF-Token")).andReturn();
        var cookie = result.getResponse().getCookie("csrf_token");
        assertNotNull(cookie);
        assertTrue(cookie.isHttpOnly());
        assertTrue(cookie.getSecure());
        assertEquals(AUTH, cookie.getPath());
        assertNull(cookie.getDomain());
        assertEquals("Lax", cookie.getAttribute("SameSite"));
        assertNull(result.getRequest().getSession(false));
        String body = result.getResponse().getContentAsString();
        String token = new tools.jackson.databind.ObjectMapper().readTree(body).get("token").asString();
        assertNotEquals(cookie.getValue(), token); // actual XOR-masked JSON token, no csrf() test shortcut
        return new Bootstrap(cookie, token);
    }

    @Test void bootstrapAndAllFourAuthPostsRequireMatchingCookieAndMaskedHeader() throws Exception {
        for (String action : List.of("register", "login", "refresh", "logout")) {
            var csrf = bootstrap();
            String path = AUTH + "/" + action;
            mvc.perform(post(path).header("Origin", ORIGIN)).andExpect(status().isForbidden());
            mvc.perform(post(path).header("Origin", ORIGIN).cookie(csrf.cookie())).andExpect(status().isForbidden());
            mvc.perform(post(path).header("Origin", ORIGIN).header("X-CSRF-Token", csrf.token()))
                    .andExpect(status().isForbidden());
            mvc.perform(post(path).header("Origin", ORIGIN).cookie(csrf.cookie()).header("X-CSRF-Token", "wrong"))
                    .andExpect(status().isForbidden());
            mvc.perform(post(path).header("Origin", ORIGIN).cookie(csrf.cookie()).header("X-CSRF-Token", csrf.cookie().getValue()))
                    .andExpect(status().isForbidden());
            mvc.perform(post(path).header("Origin", ORIGIN).cookie(csrf.cookie()).header("X-CSRF-Token", csrf.token()))
                    .andExpect(status().isNoContent()).andExpect(header().string("Cache-Control", "no-store"));
        }
    }

    @Test void loginLogoutClearCsrfAndRefreshCookieAttributesMatch() throws Exception {
        for (String action : List.of("login", "logout")) {
            var csrf = bootstrap();
            var response = mvc.perform(post(AUTH + "/" + action).header("Origin", ORIGIN)
                    .cookie(csrf.cookie()).header("X-CSRF-Token", csrf.token()))
                    .andExpect(status().isNoContent()).andReturn().getResponse();
            assertEquals(0, response.getCookie("csrf_token").getMaxAge());
            var refresh = response.getCookie("refresh_token");
            assertNotNull(refresh);
            assertTrue(refresh.isHttpOnly());
            assertTrue(refresh.getSecure());
            assertEquals("Lax", refresh.getAttribute("SameSite"));
            assertEquals(AUTH, refresh.getPath());
            assertNull(refresh.getDomain());
            assertEquals(action.equals("logout") ? 0 : 604800, refresh.getMaxAge());
            var next = bootstrap();
            mvc.perform(post(AUTH + "/refresh").header("Origin", ORIGIN)
                    .cookie(next.cookie()).header("X-CSRF-Token", csrf.token())).andExpect(status().isForbidden());
            mvc.perform(post(AUTH + "/refresh").header("Origin", ORIGIN)
                    .cookie(next.cookie()).header("X-CSRF-Token", next.token())).andExpect(status().isNoContent());
        }
    }

    @Test void rejectsForeignMissingAndNullOriginEvenWithValidCsrfAndChecksPreflight() throws Exception {
        var csrf = bootstrap();
        for (String origin : List.of("https://evil.example.test", "null", "")) {
            var request = post(AUTH + "/refresh").cookie(csrf.cookie()).header("X-CSRF-Token", csrf.token());
            if (!origin.isEmpty()) request.header("Origin", origin);
            mvc.perform(request).andExpect(status().isForbidden())
                    .andExpect(header().string("Cache-Control", "no-store"));
        }
        mvc.perform(options(AUTH + "/refresh").header("Origin", ORIGIN)
                .header("Access-Control-Request-Method", "POST").header("Access-Control-Request-Headers", "X-CSRF-Token"))
                .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin", ORIGIN))
                .andExpect(header().string("Access-Control-Allow-Credentials", "true"));
        mvc.perform(options(AUTH + "/refresh").header("Origin", "https://evil.example.test")
                .header("Access-Control-Request-Method", "POST")).andExpect(status().isForbidden());
    }

    @Test void actualBearerFilterAcceptsJwtWithoutCsrfButCookiesCannotAuthenticate() throws Exception {
        String jwt = CryptoSpikeTests.sign(keys, SignatureAlgorithm.RS256, CryptoSpikeTests.claims().build());
        mvc.perform(get("/api/v1/users/me")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/users/me").cookie(new Cookie("refresh_token", "synthetic-probe-only")))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/users/me").header("Authorization", "Bearer invalid"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/users/me").header("Authorization", "Bearer " + jwt)).andExpect(status().isOk());
        mvc.perform(post("/api/v1/spike/bearer").header("Authorization", "Bearer " + jwt))
                .andExpect(status().isNoContent());
        mvc.perform(post("/api/v1/spike/bearer")).andExpect(status().isUnauthorized());
        mvc.perform(get(AUTH + "/me").header("Authorization", "Bearer " + jwt)).andExpect(status().isNotFound());
    }
}

package com.teamai.orchestrator.infrastructure.security;

import com.teamai.orchestrator.core.application.UserService;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.*;
import org.springframework.web.cors.*;
import org.springframework.web.filter.CorsFilter;
import java.net.URI;
import java.time.Clock;
import java.util.List;

@Configuration
public class SecurityConfiguration {
    @Bean Clock clock() { return Clock.systemUTC(); }
    @Bean PasswordEncoder passwordEncoder() { return new Argon2PasswordEncoder(16, 32, 1, 19 * 1024, 2); }
    @Bean CookieCsrfTokenRepository csrfRepository() {
        var repository = new CookieCsrfTokenRepository();
        repository.setCookieName("csrf_token");
        repository.setHeaderName("X-CSRF-Token");
        repository.setCookiePath("/api/v1/auth");
        repository.setCookieCustomizer(cookie -> cookie.httpOnly(true).secure(true).sameSite("Lax"));
        return repository;
    }
    @Bean @Order(1)
    SecurityFilterChain browserAuth(HttpSecurity http, CookieCsrfTokenRepository csrf, ApiProblems problems,
                                   @Value("${app.security.allowed-origins}") List<String> origins) throws Exception {
        if (origins.isEmpty()) throw new IllegalArgumentException("Configure HTTPS browser origins");
        for (String origin : origins) {
            URI uri = URI.create(origin);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null
                    || !uri.getRawPath().isEmpty() || uri.getRawQuery() != null || uri.getRawFragment() != null) {
                throw new IllegalArgumentException("Origins must be exact HTTPS origins without a path");
            }
        }
        var cors = new CorsConfiguration();
        cors.setAllowedOrigins(origins);
        cors.setAllowCredentials(true);
        cors.setAllowedMethods(List.of("GET", "POST", "OPTIONS"));
        cors.setAllowedHeaders(List.of("Content-Type", "X-CSRF-Token"));
        var source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/v1/auth/**", cors);
        stateless(http);
        return http.securityMatcher("/api/v1/auth/**")
                .cors(c -> c.configurationSource(source))
                .csrf(c -> c.csrfTokenRepository(csrf).csrfTokenRequestHandler(new XorCsrfTokenRequestAttributeHandler()))
                .addFilterBefore(new BrowserAuthFilter(origins, problems), CorsFilter.class)
                .authorizeHttpRequests(a -> a.requestMatchers(HttpMethod.GET, "/api/v1/auth/csrf").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/auth/register", "/api/v1/auth/login").permitAll().anyRequest().denyAll())
                .exceptionHandling(e -> e.accessDeniedHandler((request, response, ex) ->
                        problems.write(request, response, 403, "CSRF_INVALID", "CSRF validation failed"))
                        .authenticationEntryPoint((request, response, ex) ->
                        problems.write(request, response, 401, "AUTH_REQUIRED", "Authentication required or invalid credentials")))
                .build();
    }
    @Bean @Order(2)
    SecurityFilterChain resources(HttpSecurity http, ApiProblems problems, JwtDecoder decoder, UserService users) throws Exception {
        stateless(http);
        // This chain authenticates only Authorization bearer tokens; the earlier auth chain retains CSRF.
        return http.csrf(c -> c.disable())
                .oauth2ResourceServer(o -> o.jwt(j -> j.decoder(decoder))
                        .authenticationEntryPoint((request, response, ex) -> {
                            response.setHeader("WWW-Authenticate", "Bearer error=\"invalid_token\"");
                            problems.write(request, response, 401, "AUTH_REQUIRED", "Authentication required or invalid credentials");
                        }))
                .addFilterAfter(new ActiveUserFilter(users, problems), BearerTokenAuthenticationFilter.class)
                .authorizeHttpRequests(a -> a.requestMatchers(HttpMethod.GET, "/api/v1/users/me").authenticated()
                        .anyRequest().denyAll())
                .exceptionHandling(e -> e.authenticationEntryPoint((request, response, ex) -> {
                    response.setHeader("WWW-Authenticate", "Bearer");
                    problems.write(request, response, 401, "AUTH_REQUIRED", "Authentication required or invalid credentials");
                })).build();
    }
    private void stateless(HttpSecurity http) throws Exception {
        http.sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(c -> c.disable()).formLogin(c -> c.disable()).httpBasic(c -> c.disable()).logout(c -> c.disable());
    }
}

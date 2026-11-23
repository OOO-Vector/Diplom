package com.teamai.orchestrator.infrastructure.security;

import com.teamai.orchestrator.core.application.UserService;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;

final class ActiveUserFilter extends OncePerRequestFilter {
    private final UserService users;
    private final ApiProblems problems;
    ActiveUserFilter(UserService users, ApiProblems problems) { this.users = users; this.problems = problems; }
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication instanceof JwtAuthenticationToken) {
            try { users.current(authentication.getName()); }
            catch (AuthenticationException exception) {
                SecurityContextHolder.clearContext();
                response.setHeader("WWW-Authenticate", "Bearer error=\"invalid_token\"");
                problems.write(request, response, 401, "AUTH_REQUIRED", "Authentication required or invalid credentials");
                return;
            }
        }
        chain.doFilter(request, response);
    }
}

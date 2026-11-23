package com.teamai.orchestrator.infrastructure.security;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.util.Collections;
import java.util.List;

final class BrowserAuthFilter extends OncePerRequestFilter {
    private final List<String> origins;
    private final ApiProblems problems;
    BrowserAuthFilter(List<String> origins, ApiProblems problems) { this.origins = origins; this.problems = problems; }
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        response.setHeader("Cache-Control", "no-store");
        if ("POST".equals(request.getMethod())) {
            var headers = Collections.list(request.getHeaders("Origin"));
            if (headers.size() != 1 || !origins.contains(headers.getFirst())) {
                problems.write(request, response, 403, "CSRF_INVALID", "CSRF validation failed");
                return;
            }
        }
        chain.doFilter(request, response);
    }
}

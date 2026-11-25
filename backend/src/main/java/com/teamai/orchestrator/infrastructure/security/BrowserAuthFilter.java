package com.teamai.orchestrator.infrastructure.security;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.*;
import java.nio.charset.StandardCharsets;
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
            byte[] body = request.getInputStream().readNBytes(16 * 1024 + 1);
            if (body.length > 16 * 1024) {
                problems.write(request, response, 413, "PAYLOAD_TOO_LARGE", "Request exceeds size limit");
                return;
            }
            request = buffered(request, body);
        }
        chain.doFilter(request, response);
    }
    private HttpServletRequest buffered(HttpServletRequest request, byte[] body) {
        return new HttpServletRequestWrapper(request) {
            public ServletInputStream getInputStream() {
                var bytes = new ByteArrayInputStream(body);
                return new ServletInputStream() {
                    public int read() { return bytes.read(); }
                    public boolean isFinished() { return bytes.available() == 0; }
                    public boolean isReady() { return true; }
                    public void setReadListener(ReadListener listener) {
                        throw new IllegalStateException("Auth request bodies use synchronous MVC reading");
                    }
                };
            }
            public BufferedReader getReader() {
                return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
            }
        };
    }
}

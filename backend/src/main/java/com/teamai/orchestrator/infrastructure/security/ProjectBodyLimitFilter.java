package com.teamai.orchestrator.infrastructure.security;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Set;

/** Bound allocation before MVC parses project JSON, including chunked requests. Auth has its own unchanged limit. */
final class ProjectBodyLimitFilter extends OncePerRequestFilter {
    private final ApiProblems problems;
    ProjectBodyLimitFilter(ApiProblems problems) { this.problems = problems; }
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        // Raw specification streams are bounded by the import service, after project authorization.
        if (request.getMethod().equals("POST") && path.matches("/api/v1/projects/[^/]+/specifications")) return true;
        return !(path.equals("/api/v1/projects") || path.startsWith("/api/v1/projects/"))
                || !Set.of("POST", "PATCH", "DELETE").contains(request.getMethod());
    }
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws IOException, ServletException {
        byte[] body = request.getInputStream().readNBytes(32 * 1024 + 1);
        if (body.length > 32 * 1024) {
            problems.write(request, response, 413, "PAYLOAD_TOO_LARGE", "Request exceeds size limit"); return;
        }
        chain.doFilter(new HttpServletRequestWrapper(request) {
            public ServletInputStream getInputStream() {
                var bytes = new ByteArrayInputStream(body);
                return new ServletInputStream() {
                    public int read() { return bytes.read(); }
                    public boolean isFinished() { return bytes.available() == 0; }
                    public boolean isReady() { return true; }
                    public void setReadListener(ReadListener listener) { throw new IllegalStateException("Synchronous MVC request body"); }
                };
            }
            public BufferedReader getReader() { return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8)); }
        }, response);
    }
}

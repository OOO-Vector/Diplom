package com.teamai.orchestrator.infrastructure.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.*;

@Component
public class ApiProblems {
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(ApiProblems.class);
    private final ObjectMapper json;
    public ApiProblems(ObjectMapper json) { this.json = json; }
    public Map<String, Object> body(int status, String code, String title) {
        return Map.of("type", "urn:team-ai:problem:" + code.toLowerCase(Locale.ROOT).replace('_', '-'),
                "title", title, "status", status, "code", code, "detail", title,
                "correlationId", UUID.randomUUID().toString());
    }
    public Map<String, Object> unexpected(Exception exception) {
        var problem = body(500, "INTERNAL_ERROR", "Unexpected server failure");
        // Exception messages/causes and request metadata can contain credentials. Log only safe identifiers.
        log.atError().addKeyValue("event", "unexpected_server_error")
                .addKeyValue("correlationId", problem.get("correlationId"))
                .addKeyValue("exceptionType", exception.getClass().getName())
                .addKeyValue("status", 500).log("Unexpected server failure");
        return problem;
    }
    public void write(HttpServletRequest request, HttpServletResponse response, int status, String code, String title) throws IOException {
        response.setStatus(status);
        response.setContentType("application/problem+json");
        response.setHeader("Cache-Control", "no-store");
        json.writeValue(response.getOutputStream(), body(status, code, title));
    }
}

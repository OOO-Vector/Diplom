package com.teamai.orchestrator.infrastructure.security;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import java.sql.SQLException;
import java.util.Map;

@RestControllerAdvice
public class ApiExceptionHandler {
    private final ApiProblems problems;
    public ApiExceptionHandler(ApiProblems problems) { this.problems = problems; }
    private ResponseEntity<Map<String, Object>> response(int status, String code, String title) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .cacheControl(CacheControl.noStore()).body(problems.body(status, code, title));
    }
    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class})
    public ResponseEntity<?> invalid() { return response(400, "VALIDATION_ERROR", "Invalid request"); }
    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<?> unauthorized() { return response(401, "AUTH_REQUIRED", "Authentication required or invalid credentials"); }
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<?> conflict(DataIntegrityViolationException exception) {
        for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql && "23505".equals(sql.getSQLState())
                    && sql.getMessage().contains("ux_users_email_ci")) {
                return response(409, "EMAIL_ALREADY_EXISTS", "Email already registered");
            }
        }
        return response(500, "INTERNAL_ERROR", "Unexpected server failure");
    }
}

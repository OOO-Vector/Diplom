package com.teamai.orchestrator.infrastructure.security;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import jakarta.servlet.http.HttpServletRequest;
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
    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class,
            org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class,
            org.springframework.web.bind.ServletRequestBindingException.class})
    public ResponseEntity<?> invalid() { return response(400, "VALIDATION_ERROR", "Invalid request"); }
    @ExceptionHandler(org.springframework.web.method.annotation.HandlerMethodValidationException.class)
    public ResponseEntity<?> methodValidation(org.springframework.web.method.annotation.HandlerMethodValidationException exception) {
        return exception.isForReturnValue() ? unexpected(exception) : invalid();
    }
    @ExceptionHandler(com.teamai.orchestrator.core.application.CoreException.class)
    public ResponseEntity<?> core(com.teamai.orchestrator.core.application.CoreException exception) {
        return response(exception.status(), exception.code(), exception.getMessage());
    }
    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<?> unauthorized(HttpServletRequest request) {
        if ((request.getContextPath() + "/api/v1/auth/login").equals(request.getRequestURI())) {
            return response(401, "INVALID_CREDENTIALS", "Invalid credentials");
        }
        return ResponseEntity.status(401).contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .cacheControl(CacheControl.noStore()).header("WWW-Authenticate", "Bearer error=\"invalid_token\"")
                .body(problems.body(401, "AUTH_REQUIRED", "Authentication required or invalid credentials"));
    }
    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<?> method(org.springframework.web.HttpRequestMethodNotSupportedException exception) {
        var supported = exception.getSupportedHttpMethods();
        return ResponseEntity.status(405).contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .cacheControl(CacheControl.noStore()).allow(supported == null ? new HttpMethod[0] : supported.toArray(HttpMethod[]::new))
                .body(problems.body(405, "METHOD_NOT_ALLOWED", "Method not allowed"));
    }
    @ExceptionHandler(org.springframework.web.servlet.resource.NoResourceFoundException.class)
    public ResponseEntity<?> missing() { return response(404, "NOT_FOUND", "Resource not found"); }
    @ExceptionHandler(org.springframework.web.HttpMediaTypeNotAcceptableException.class)
    public ResponseEntity<?> unacceptable() { return response(406, "NOT_ACCEPTABLE", "Response media type not acceptable"); }
    @ExceptionHandler(AuthRateLimiter.Limited.class)
    public ResponseEntity<?> limited(AuthRateLimiter.Limited exception) {
        return ResponseEntity.status(429).contentType(MediaType.APPLICATION_PROBLEM_JSON).cacheControl(CacheControl.noStore())
                .header("Retry-After", Long.toString(exception.retryAfter()))
                .body(problems.body(429, "RATE_LIMITED", "Too many requests"));
    }
    @ExceptionHandler(org.springframework.web.HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<?> mediaType() { return response(415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported media type"); }
    @ExceptionHandler(Exception.class)
    public ResponseEntity<?> unexpected(Exception exception) {
        return ResponseEntity.status(500).contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .cacheControl(CacheControl.noStore()).body(problems.unexpected(exception));
    }
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<?> conflict(DataIntegrityViolationException exception) {
        for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql && "23505".equals(sql.getSQLState())
                    && sql.getMessage().contains("ux_users_email_ci")) {
                return response(409, "EMAIL_ALREADY_EXISTS", "Email already registered");
            }
        }
        return unexpected(exception);
    }
}

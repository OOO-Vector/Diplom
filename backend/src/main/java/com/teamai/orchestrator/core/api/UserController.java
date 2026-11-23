package com.teamai.orchestrator.core.api;

import com.teamai.orchestrator.core.application.UserService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;
import java.util.Map;
import jakarta.servlet.http.HttpServletRequest;
import com.teamai.orchestrator.infrastructure.security.AuthRateLimiter;

@RestController
public class UserController {
    private final UserService users;
    private final AuthRateLimiter limits;
    public UserController(UserService users, AuthRateLimiter limits) { this.users = users; this.limits = limits; }

    @GetMapping("/api/v1/auth/csrf")
    public Map<String, String> csrf(CsrfToken csrf) {
        return Map.of("headerName", csrf.getHeaderName(), "token", csrf.getToken());
    }
    @PostMapping("/api/v1/auth/register")
    @ResponseStatus(HttpStatus.CREATED)
    public UserResponse register(@Valid @RequestBody RegisterRequest request, HttpServletRequest http) {
        limits.acquire("register:" + http.getRemoteAddr(), 5);
        return users.register(request);
    }

    @GetMapping("/api/v1/users/me")
    public UserResponse me(Authentication authentication) { return users.current(authentication.getName()); }
}

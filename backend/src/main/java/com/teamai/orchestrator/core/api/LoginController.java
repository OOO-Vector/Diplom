package com.teamai.orchestrator.core.api;

import com.teamai.orchestrator.core.application.LoginService;
import jakarta.servlet.http.*;
import jakarta.validation.Valid;
import org.springframework.http.ResponseCookie;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.web.bind.annotation.*;
import java.time.*;
import java.util.Locale;
import com.teamai.orchestrator.infrastructure.security.AuthRateLimiter;

@RestController
public class LoginController {
    private final LoginService logins;
    private final CookieCsrfTokenRepository csrf;
    private final Clock clock;
    private final AuthRateLimiter limits;
    public LoginController(LoginService logins, CookieCsrfTokenRepository csrf, Clock clock, AuthRateLimiter limits) {
        this.logins = logins; this.csrf = csrf; this.clock = clock; this.limits = limits;
    }
    @PostMapping("/api/v1/auth/login")
    public TokenResponse login(@Valid @RequestBody LoginRequest input, HttpServletRequest request, HttpServletResponse response) {
        limits.acquire("login-ip:" + request.getRemoteAddr(), 20);
        limits.acquire("login-account:" + input.email().toLowerCase(Locale.ROOT), 5);
        var login = logins.login(input);
        long remaining = Math.max(0, Duration.between(clock.instant(), login.expiresAt()).getSeconds());
        response.addHeader("Set-Cookie", ResponseCookie.from("refresh_token", login.refreshToken()).httpOnly(true)
                .secure(true).sameSite("Lax").path("/api/v1/auth").maxAge(remaining).build().toString());
        csrf.saveToken(null, request, response);
        return login.response();
    }
}

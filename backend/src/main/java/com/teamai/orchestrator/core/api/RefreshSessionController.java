package com.teamai.orchestrator.core.api;

import com.teamai.orchestrator.core.application.RefreshSessionService;
import com.teamai.orchestrator.infrastructure.security.ApiProblems;
import jakarta.servlet.http.*;
import org.springframework.http.*;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.web.bind.annotation.*;
import java.io.IOException;
import java.time.*;

@RestController
public class RefreshSessionController {
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(RefreshSessionController.class);
    private final RefreshSessionService sessions;
    private final CookieCsrfTokenRepository csrf;
    private final ApiProblems problems;
    private final Clock clock;
    public RefreshSessionController(RefreshSessionService sessions, CookieCsrfTokenRepository csrf, ApiProblems problems, Clock clock) {
        this.sessions = sessions; this.csrf = csrf; this.problems = problems; this.clock = clock;
    }
    @PostMapping("/api/v1/auth/refresh")
    public ResponseEntity<?> refresh(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (request.getInputStream().read() != -1) return invalidBody();
        var result = sessions.refresh(credential(request));
        if (result.response() == null) {
            clear(response);
            csrf.saveToken(null, request, response);
            var problem = problems.body(401, "REFRESH_INVALID", "Refresh credential invalid");
            if (result.replayedFamily() != null) {
                log.atWarn().addKeyValue("event", "refresh_replay").addKeyValue("familyId", result.replayedFamily())
                        .addKeyValue("correlationId", problem.get("correlationId")).log("Refresh family revoked after replay");
            }
            return ResponseEntity.status(401).contentType(MediaType.APPLICATION_PROBLEM_JSON).body(problem);
        }
        cookie(response, result.credential(), Math.max(0, Duration.between(clock.instant(), result.expiresAt()).getSeconds()));
        return ResponseEntity.ok(result.response());
    }
    @PostMapping("/api/v1/auth/logout")
    public ResponseEntity<?> logout(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (request.getInputStream().read() != -1) return invalidBody();
        sessions.logout(credential(request));
        clear(response);
        csrf.saveToken(null, request, response);
        return ResponseEntity.noContent().build();
    }
    private ResponseEntity<?> invalidBody() {
        return ResponseEntity.badRequest().contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problems.body(400, "VALIDATION_ERROR", "Request body must be empty"));
    }
    private String credential(HttpServletRequest request) {
        String value = null;
        int count = 0;
        if (request.getCookies() != null) for (var cookie : request.getCookies()) {
            if (cookie.getName().equals("refresh_token")) {
                if (++count > 1) return null; // Ambiguous duplicate cookies are not credentials.
                value = cookie.getValue();
            }
        }
        return value;
    }
    private void clear(HttpServletResponse response) { cookie(response, "", 0); }
    private void cookie(HttpServletResponse response, String value, long maxAge) {
        response.addHeader("Set-Cookie", ResponseCookie.from("refresh_token", value).httpOnly(true).secure(true)
                .sameSite("Lax").path("/api/v1/auth").maxAge(maxAge).build().toString());
    }
}

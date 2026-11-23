package com.teamai.orchestrator.core.application;

import com.teamai.orchestrator.core.api.*;
import com.teamai.orchestrator.core.persistence.*;
import com.teamai.orchestrator.infrastructure.security.AccessTokenIssuer;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.Base64;

@Service
public class LoginService {
    private final UserRepository users;
    private final RefreshSessionStore sessions;
    private final PasswordEncoder passwords;
    private final AccessTokenIssuer tokens;
    private final TransactionTemplate transactions;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();
    private final String dummyHash;
    public LoginService(UserRepository users, RefreshSessionStore sessions, PasswordEncoder passwords,
                        AccessTokenIssuer tokens, TransactionTemplate transactions, Clock clock) {
        this.users = users; this.sessions = sessions; this.passwords = passwords; this.tokens = tokens;
        this.transactions = transactions; this.clock = clock;
        this.dummyHash = passwords.encode(Base64.getEncoder().encodeToString(random.generateSeed(32)));
    }
    public record IssuedLogin(TokenResponse response, String refreshToken, Instant expiresAt) {
        @Override public String toString() { return "IssuedLogin[redacted]"; }
    }
    public IssuedLogin login(LoginRequest request) {
        var candidate = users.findByEmail(request.email());
        String hash = candidate.map(u -> u.getPasswordHash()).orElse(dummyHash);
        boolean matches = passwords.matches(request.password(), hash);
        if (!matches || candidate.isEmpty() || !candidate.get().isActive()) throw invalid();
        var id = candidate.get().getId();
        return transactions.execute(status -> {
            var user = users.findById(id).filter(u -> u.isActive() && u.getPasswordHash().equals(hash)).orElseThrow(LoginService::invalid);
            var issued = clock.instant().truncatedTo(ChronoUnit.MICROS);
            var expires = issued.plus(Duration.ofDays(7));
            byte[] bytes = new byte[32]; random.nextBytes(bytes);
            String refresh = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
            sessions.insert(id, digest(refresh), issued, expires);
            return new IssuedLogin(new TokenResponse(tokens.issue(id), "Bearer", 900, UserResponse.from(user)), refresh, expires);
        }); // Return credentials only after both inserts and signing commit successfully.
    }
    private static BadCredentialsException invalid() { return new BadCredentialsException("Invalid credentials"); }
    private static byte[] digest(String token) {
        try { return MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.US_ASCII)); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException("SHA-256 unavailable", impossible); }
    }
}

package com.teamai.orchestrator.core.application;

import com.teamai.orchestrator.core.api.*;
import com.teamai.orchestrator.core.persistence.*;
import com.teamai.orchestrator.infrastructure.security.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.*;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

@Service
public class RefreshSessionService {
    private final RefreshSessionStore sessions;
    private final UserRepository users;
    private final AccessTokenIssuer tokens;
    private final RefreshRateLimiter limits;
    private final Clock clock;
    private final TransactionTemplate transactions;

    public RefreshSessionService(RefreshSessionStore sessions, UserRepository users, AccessTokenIssuer tokens,
                                 RefreshRateLimiter limits, Clock clock, PlatformTransactionManager manager) {
        this.sessions = sessions; this.users = users; this.tokens = tokens; this.limits = limits; this.clock = clock;
        transactions = new TransactionTemplate(manager);
        transactions.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        transactions.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }
    public record Result(TokenResponse response, String credential, Instant expiresAt, UUID replayedFamily) {
        static Result invalid(UUID replayedFamily) { return new Result(null, null, null, replayedFamily); }
        @Override public String toString() { return "RefreshResult[redacted]"; }
    }

    public Result refresh(String credential) {
        var digest = RefreshTokens.digest(credential);
        if (digest.isEmpty()) return Result.invalid(null);
        return transactions.execute(status -> {
            var found = sessions.lockFamily(digest.get());
            if (found.isEmpty()) return Result.invalid(null);
            var family = found.get();
            var generation = sessions.generation(family.id(), digest.get());
            var now = clock.instant().truncatedTo(ChronoUnit.MICROS); // Fresh instant after the lock wait.
            if (generation.consumedAt() != null) {
                sessions.revoke(family, now);
                return Result.invalid(family.id()); // Normal return commits revocation before the HTTP 401/audit.
            }
            if (family.revokedAt() != null || generation.revokedAt() != null || !now.isBefore(family.expiresAt())
                    || now.isBefore(generation.issuedAt())) return Result.invalid(null);
            var user = users.findById(family.userId()).filter(u -> u.isActive());
            if (user.isEmpty()) return Result.invalid(null);
            limits.acquire(family.id()); // Never rate-limit away detection/revocation of a consumed generation.
            String replacement = RefreshTokens.generate();
            sessions.rotate(family, generation, RefreshTokens.digest(replacement).orElseThrow(), now);
            return new Result(new TokenResponse(tokens.issue(family.userId()), "Bearer", 900, UserResponse.from(user.get())),
                    replacement, family.expiresAt(), null);
        });
    }

    public void logout(String credential) {
        var digest = RefreshTokens.digest(credential);
        if (digest.isEmpty()) return;
        transactions.executeWithoutResult(status -> sessions.lockFamily(digest.get()).ifPresent(family -> {
            sessions.generation(family.id(), digest.get()); // Re-read after locking, including consumed/expired generations.
            sessions.revoke(family, clock.instant().truncatedTo(ChronoUnit.MICROS));
        }));
    }
}

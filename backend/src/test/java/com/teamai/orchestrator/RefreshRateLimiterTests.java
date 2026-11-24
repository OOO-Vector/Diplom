package com.teamai.orchestrator;

import com.teamai.orchestrator.infrastructure.security.*;
import org.junit.jupiter.api.Test;
import java.time.*;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

class RefreshRateLimiterTests {
    @Test void capacityPressureCannotDenyAllOtherFamilies() {
        var limiter = new RefreshRateLimiter(Clock.fixed(Instant.parse("2026-11-24T12:00:00Z"), ZoneOffset.UTC));
        for (int i = 0; i < 10_001; i++) limiter.acquire(UUID.randomUUID());
        var family = UUID.randomUUID();
        for (int i = 0; i < 30; i++) assertDoesNotThrow(() -> limiter.acquire(family));
        assertThrows(AuthRateLimiter.Limited.class, () -> limiter.acquire(family));
        assertDoesNotThrow(() -> limiter.acquire(UUID.randomUUID()));
    }
    @Test void familyBudgetExpiresAtWindowBoundary() {
        var now = new java.util.concurrent.atomic.AtomicReference<>(Instant.parse("2026-11-24T12:00:00Z"));
        var clock = new Clock() {
            public ZoneId getZone() { return ZoneOffset.UTC; }
            public Clock withZone(ZoneId zone) { return this; }
            public Instant instant() { return now.get(); }
        };
        var limiter = new RefreshRateLimiter(clock); var family = UUID.randomUUID();
        for (int i = 0; i < 30; i++) limiter.acquire(family);
        assertThrows(AuthRateLimiter.Limited.class, () -> limiter.acquire(family));
        now.set(now.get().plusSeconds(60)); assertDoesNotThrow(() -> limiter.acquire(family));
    }
}

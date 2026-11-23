package com.teamai.orchestrator;

import com.teamai.orchestrator.infrastructure.security.AuthRateLimiter;
import org.junit.jupiter.api.Test;
import java.time.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class AuthRateLimiterTests {
    @Test void limitIsAtomicAndWindowExpires() throws Exception {
        var now = new java.util.concurrent.atomic.AtomicReference<>(Instant.parse("2026-11-23T12:00:00Z"));
        Clock clock = new Clock() {
            public ZoneId getZone() { return ZoneOffset.UTC; }
            public Clock withZone(ZoneId zone) { return this; }
            public Instant instant() { return now.get(); }
        };
        var limiter = new AuthRateLimiter(clock); var accepted = new AtomicInteger();
        try (var pool = Executors.newFixedThreadPool(8)) {
            var jobs = new java.util.ArrayList<Future<?>>();
            for (int i = 0; i < 30; i++) jobs.add(pool.submit(() -> {
                try { limiter.acquire("same-key", 5); accepted.incrementAndGet(); }
                catch (AuthRateLimiter.Limited expected) { assertTrue(expected.retryAfter() > 0); }
            }));
            for (var job : jobs) job.get(10, TimeUnit.SECONDS);
        }
        assertEquals(5, accepted.get());
        now.set(now.get().plusSeconds(60)); assertDoesNotThrow(() -> limiter.acquire("same-key", 5));
    }
}

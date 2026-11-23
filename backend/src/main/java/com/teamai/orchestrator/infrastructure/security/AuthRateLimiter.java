package com.teamai.orchestrator.infrastructure.security;

import org.springframework.stereotype.Component;
import java.time.*;
import java.util.*;

/** Single-instance MVP limiter. Bounded storage; a full table fails closed until its oldest window expires. */
@Component
public class AuthRateLimiter {
    private record Window(Instant expires, int count) {}
    private final Map<String, Window> windows = new HashMap<>();
    private final Clock clock;
    public AuthRateLimiter(Clock clock) { this.clock = clock; }
    public static class Limited extends RuntimeException {
        private final long retryAfter;
        Limited(long retryAfter) { super("Too many requests"); this.retryAfter = retryAfter; }
        public long retryAfter() { return retryAfter; }
    }
    public synchronized void acquire(String key, int limit) {
        Instant now = clock.instant();
        windows.values().removeIf(window -> !window.expires().isAfter(now));
        var window = windows.get(key);
        if (window == null) {
            if (windows.size() >= 10_000) throw new Limited(60);
            windows.put(key, new Window(now.plusSeconds(60), 1));
        } else {
            if (window.count() >= limit) throw new Limited(Math.max(1, Duration.between(now, window.expires()).toSeconds() + 1));
            windows.put(key, new Window(window.expires(), window.count() + 1));
        }
    }
}

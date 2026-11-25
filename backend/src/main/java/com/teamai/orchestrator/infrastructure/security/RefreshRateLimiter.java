package com.teamai.orchestrator.infrastructure.security;

import org.springframework.stereotype.Component;
import java.time.*;
import java.util.*;

/** Known, usable families only. Invalid credentials cannot fill the table or exhaust other auth budgets. */
@Component
public class RefreshRateLimiter {
    private record Window(Instant expires, int count) {}
    private final LinkedHashMap<UUID, Window> windows = new LinkedHashMap<>();
    private final Clock clock;
    public RefreshRateLimiter(Clock clock) { this.clock = clock; }
    public synchronized void acquire(UUID family) {
        Instant now = clock.instant();
        windows.values().removeIf(window -> !window.expires().isAfter(now));
        var window = windows.get(family);
        if (window == null) {
            // Capacity pressure evicts the oldest budget, never blocks unrelated families globally.
            if (windows.size() >= 10_000) windows.pollFirstEntry();
            windows.put(family, new Window(now.plusSeconds(60), 1));
        } else {
            if (window.count() >= 30) throw new AuthRateLimiter.Limited(Math.max(1, Duration.between(now, window.expires()).toSeconds() + 1));
            windows.put(family, new Window(window.expires(), window.count() + 1));
        }
    }
}

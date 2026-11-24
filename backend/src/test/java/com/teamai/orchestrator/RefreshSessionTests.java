package com.teamai.orchestrator;

import com.teamai.orchestrator.core.application.*;
import com.teamai.orchestrator.core.persistence.*;
import com.teamai.orchestrator.infrastructure.security.*;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.PlatformTransactionManager;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

class RefreshSessionTests extends AuthApiTestSupport {
    @Autowired JwtDecoder decoder;
    @Autowired UserRepository users;
    @Autowired RefreshRateLimiter limits;
    @Autowired Clock clock;
    @Autowired PlatformTransactionManager manager;
    @MockitoSpyBean AccessTokenIssuer signer;
    @MockitoSpyBean RefreshSessionStore store;
    RefreshSessionStore storeTarget() { return org.springframework.test.util.AopTestUtils.getUltimateTargetObject(store); }

    record Login(String email, UUID userId, UUID family, String credential, String access, Instant expires) {}
    Login login() throws Exception {
        String email = UUID.randomUUID() + "@example.test";
        assertEquals(201, mvc.perform(registration(body(email), csrf())).andReturn().getResponse().getStatus());
        return login(email);
    }
    Login login(String email) throws Exception {
        var csrf = csrf();
        var response = mvc.perform(post("/api/v1/auth/login").secure(true).header("Origin", ORIGIN)
                .with(request -> { request.setRemoteAddr("2001:db8:" + UUID.randomUUID()); return request; })
                .cookie(csrf.cookie()).header("X-CSRF-Token", csrf.token()).contentType("application/json")
                .content(json.writeValueAsString(Map.of("email", email, "password", PASSWORD)))).andReturn().getResponse();
        assertEquals(200, response.getStatus());
        String token = response.getCookie("refresh_token").getValue();
        var row = row(token);
        return new Login(email, (UUID)row.get("user_id"), (UUID)row.get("family_id"), token,
                json.readTree(response.getContentAsString()).get("accessToken").asString(), ((Timestamp)row.get("expires_at")).toInstant());
    }
    Map<String, Object> row(String token) {
        return jdbc.queryForMap("""
                select s.*, f.user_id, f.revoked_at as family_revoked from refresh_sessions s
                join refresh_token_families f on f.id = s.family_id where s.token_hash = ?
                """, RefreshTokens.digest(token).orElseThrow());
    }
    MockHttpServletRequestBuilder command(String route, String token, Csrf csrf) {
        var request = post("/api/v1/auth/" + route).secure(true).header("Origin", ORIGIN)
                .cookie(csrf.cookie()).header("X-CSRF-Token", csrf.token());
        if (token != null) request.cookie(new Cookie("refresh_token", token));
        return request;
    }
    MockHttpServletResponse refresh(String token) throws Exception {
        return mvc.perform(command("refresh", token, csrf())).andReturn().getResponse();
    }
    void cookie(MockHttpServletResponse response, boolean cleared) {
        assertEquals("no-store", response.getHeader("Cache-Control"));
        var cookie = response.getCookie("refresh_token"); assertNotNull(cookie);
        assertTrue(cookie.isHttpOnly()); assertTrue(cookie.getSecure()); assertNull(cookie.getDomain());
        assertEquals("Lax", cookie.getAttribute("SameSite")); assertEquals("/api/v1/auth", cookie.getPath());
        if (cleared) { assertEquals(0, cookie.getMaxAge()); assertEquals("", cookie.getValue()); }
        else assertTrue(cookie.getMaxAge() > 0 && cookie.getMaxAge() <= 604800);
    }
    void invalid(MockHttpServletResponse response) throws Exception {
        assertEquals(401, response.getStatus()); assertEquals("application/problem+json", response.getContentType());
        assertEquals("REFRESH_INVALID", json.readTree(response.getContentAsString()).get("code").asString());
        cookie(response, true);
    }
    long generations(UUID family) { return jdbc.queryForObject("select count(*) from refresh_sessions where family_id=?", Long.class, family); }

    @Test void rotatesRepeatedlyWithDigestLinkageAndOriginalAbsoluteExpiry() throws Exception {
        var login = login(); String previous = login.credential(); String access = login.access();
        for (int i = 0; i < 3; i++) {
            var response = refresh(previous); assertEquals(200, response.getStatus()); cookie(response, false);
            String next = response.getCookie("refresh_token").getValue();
            assertNotEquals(previous, next); assertEquals(32, Base64.getUrlDecoder().decode(next).length);
            var dto = json.readTree(response.getContentAsString());
            String jwt = dto.get("accessToken").asString(); assertNotEquals(access, jwt);
            var decoded = decoder.decode(jwt);
            assertEquals(login.userId().toString(), decoded.getSubject());
            assertEquals(Duration.ofMinutes(15), Duration.between(decoded.getIssuedAt(), decoded.getExpiresAt()));
            var current = row(next); var old = row(previous);
            assertArrayEquals(java.security.MessageDigest.getInstance("SHA-256").digest(next.getBytes(java.nio.charset.StandardCharsets.US_ASCII)), (byte[])current.get("token_hash"));
            assertEquals(current.get("id"), old.get("replacement_id")); assertNotNull(old.get("consumed_at"));
            assertNull(current.get("consumed_at")); assertEquals(login.family(), current.get("family_id"));
            assertEquals(login.expires(), ((Timestamp)current.get("expires_at")).toInstant());
            assertTrue(response.getCookie("refresh_token").getMaxAge() <= Duration.between(clock.instant(), login.expires()).getSeconds() + 1);
            assertFalse(response.getContentAsString().contains(next));
            previous = next; access = jwt;
        }
        assertEquals(4, generations(login.family()));
        assertEquals("team_ai_app", jdbc.queryForObject("select current_user", String.class));
    }

    @Test void malformedUnknownMissingAndDuplicateCookiesFailWithoutPersistence() throws Exception {
        long before = jdbc.queryForObject("select count(*) from refresh_sessions", Long.class);
        invalid(refresh(null));
        String canonical = RefreshTokens.generate();
        for (String token : List.of("", "bad", "a".repeat(42), "a".repeat(44), canonical + "=", canonical.substring(0, 42) + "B", canonical)) invalid(refresh(token));
        var login = login();
        invalid(mvc.perform(command("refresh", login.credential(), csrf()).cookie(new Cookie("refresh_token", canonical))).andReturn().getResponse());
        assertEquals(before + 1, jdbc.queryForObject("select count(*) from refresh_sessions", Long.class));
        assertNull(row(login.credential()).get("consumed_at"));
    }

    @Test void expiredRevokedGenerationRevokedFamilyAndDisabledUsersAreRejected() throws Exception {
        var login = login();
        var expired = RefreshTokens.generate(); var family = UUID.randomUUID(); var issued = clock.instant().minus(Duration.ofDays(8));
        jdbc.update("insert into refresh_token_families(id,user_id,issued_at,expires_at) values (?,?,?,?)",
                family, login.userId(), Timestamp.from(issued), Timestamp.from(issued.plus(Duration.ofDays(7))));
        jdbc.update("insert into refresh_sessions(id,family_id,family_issued_at,expires_at,issued_at,token_hash) values (?,?,?,?,?,?)",
                UUID.randomUUID(), family, Timestamp.from(issued), Timestamp.from(issued.plus(Duration.ofDays(7))), Timestamp.from(issued), RefreshTokens.digest(expired).orElseThrow());
        invalid(refresh(expired));
        var revoked = login(); jdbc.update("update refresh_token_families set revoked_at=expires_at where id=?", revoked.family()); invalid(refresh(revoked.credential()));
        var generation = login(); jdbc.update("update refresh_sessions set revoked_at=expires_at where family_id=?", generation.family()); invalid(refresh(generation.credential()));
        jdbc.update("update users set is_active=false where id=?", login.userId()); invalid(refresh(login.credential()));
        assertEquals(1, generations(login.family()));
        assertEquals(204, mvc.perform(command("logout", expired, csrf())).andReturn().getResponse().getStatus());
        assertNotNull(row(expired).get("family_revoked"));
    }

    @Test void replayCommitsFamilyRevocationAndAuditsSafeCorrelationBeforeReturning401() throws Exception {
        var login = login(); var success = refresh(login.credential());
        String next = success.getCookie("refresh_token").getValue();
        var logger = (ch.qos.logback.classic.Logger)org.slf4j.LoggerFactory.getLogger(com.teamai.orchestrator.core.api.RefreshSessionController.class);
        var appender = new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>(); appender.start(); logger.addAppender(appender);
        try {
            var replay = refresh(login.credential()); invalid(replay);
            assertNotNull(row(next).get("family_revoked")); // A separate committed app connection observes revocation.
            assertEquals(1, appender.list.size()); var event = appender.list.getFirst();
            var correlation = json.readTree(replay.getContentAsString()).get("correlationId").asString();
            assertTrue(event.getKeyValuePairs().stream().anyMatch(kv -> kv.key.equals("correlationId") && kv.value.equals(correlation)));
            String log = event.getFormattedMessage() + event.getKeyValuePairs();
            assertFalse(log.contains(login.credential())); assertFalse(log.contains(next));
            assertFalse(log.contains(HexFormat.of().formatHex(RefreshTokens.digest(login.credential()).orElseThrow())));
            assertNull(event.getThrowableProxy());
            invalid(refresh(next)); assertEquals(2, generations(login.family()));
            assertEquals(200, mvc.perform(get("/api/v1/users/me").header("Authorization", "Bearer " + login.access())).andReturn().getResponse().getStatus());
        } finally { logger.detachAppender(appender); appender.stop(); }
    }

    @Test void logoutIsIdempotentAndIsolatesLoginFamilies() throws Exception {
        var first = login(); var second = login(first.email());
        for (String token : Arrays.asList(first.credential(), first.credential(), null, "bad", RefreshTokens.generate())) {
            var response = mvc.perform(command("logout", token, csrf())).andReturn().getResponse();
            assertEquals(204, response.getStatus()); assertEquals("", response.getContentAsString()); cookie(response, true);
            assertEquals(0, response.getCookie("csrf_token").getMaxAge());
        }
        assertNotNull(row(first.credential()).get("family_revoked")); assertNull(row(second.credential()).get("family_revoked"));
        invalid(refresh(first.credential())); assertEquals(200, refresh(second.credential()).getStatus());
        assertEquals(1, generations(first.family())); csrf();
    }

    @Test void logoutWithConsumedCredentialRevokesSuccessorAndCsrfCanBeBootstrappedAgain() throws Exception {
        var login = login(); var next = refresh(login.credential()).getCookie("refresh_token").getValue();
        var previousCsrf = csrf();
        var logout = mvc.perform(command("logout", login.credential(), previousCsrf)).andReturn().getResponse();
        assertEquals(204, logout.getStatus()); assertEquals(0, logout.getCookie("csrf_token").getMaxAge());
        var newCsrf = csrf(); assertNotEquals(previousCsrf.cookie().getValue(), newCsrf.cookie().getValue());
        var rejected = mvc.perform(command("refresh", next, newCsrf)).andReturn().getResponse(); invalid(rejected);
        assertEquals(0, rejected.getCookie("csrf_token").getMaxAge());
        var afterRejection = csrf();
        assertEquals(204, mvc.perform(command("logout", null, afterRejection)).andReturn().getResponse().getStatus());
        assertEquals(2, generations(login.family()));
    }

    @Test void strictBrowserGuardsRunBeforeStateChangesAndBodiesAreRejected() throws Exception {
        var login = login(); var csrf = csrf();
        for (String route : List.of("refresh", "logout")) {
            for (String origin : List.of("", "null", "https://foreign.example.test")) {
                var request = command(route, login.credential(), csrf); request.headers(h -> h.remove("Origin"));
                if (!origin.isEmpty()) request.header("Origin", origin);
                assertEquals(403, mvc.perform(request).andReturn().getResponse().getStatus());
            }
            assertEquals(403, mvc.perform(command(route, login.credential(), csrf).header("Origin", ORIGIN)).andReturn().getResponse().getStatus());
            assertEquals(403, mvc.perform(command(route, login.credential(), new Csrf(csrf.cookie(), "wrong"))).andReturn().getResponse().getStatus());
            assertEquals(403, mvc.perform(post("/api/v1/auth/"+route).header("Origin", ORIGIN).cookie(new Cookie("refresh_token", login.credential()))).andReturn().getResponse().getStatus());
            assertEquals(400, mvc.perform(command(route, login.credential(), csrf).contentType("application/json").content("{}")).andReturn().getResponse().getStatus());
        }
        assertNull(row(login.credential()).get("consumed_at")); assertNull(row(login.credential()).get("family_revoked"));
        assertEquals(1, generations(login.family()));
    }

    @Test void signingAndCommitFailuresRollBackRotationAndExposeNoCredential() throws Exception {
        var login = login();
        doThrow(new IllegalStateException("Synthetic signing failure")).when(signer).issue(login.userId());
        var failed = refresh(login.credential()); assertEquals(500, failed.getStatus()); assertNull(failed.getCookie("refresh_token"));
        assertEquals(1, generations(login.family())); assertNull(row(login.credential()).get("consumed_at"));
        reset(signer);
        doAnswer(invocation -> {
            invocation.callRealMethod();
            jdbc.update("update refresh_sessions set replacement_id=? where id=?", UUID.randomUUID(), row(login.credential()).get("id"));
            return null;
        }).when(storeTarget()).rotate(any(), any(), any(byte[].class), any());
        failed = refresh(login.credential()); assertEquals(500, failed.getStatus()); assertNull(failed.getCookie("refresh_token"));
        assertEquals(1, generations(login.family())); assertNull(row(login.credential()).get("consumed_at"));
        reset(storeTarget());
        assertEquals(200, refresh(login.credential()).getStatus());
    }

    @Test void databaseFailureIsNotConvertedToSuccessfulLogoutOrInvalidCredential() throws Exception {
        var login = login();
        doAnswer(invocation -> { jdbc.queryForList("select * from databasechangelog"); return invocation.callRealMethod(); })
                .when(storeTarget()).lockFamily(any(byte[].class)); // Real permission failure using restricted application role.
        for (String route : List.of("refresh", "logout")) {
            var response = mvc.perform(command(route, login.credential(), csrf())).andReturn().getResponse();
            assertEquals(500, response.getStatus()); assertNull(response.getCookie("refresh_token"));
            assertEquals("INTERNAL_ERROR", json.readTree(response.getContentAsString()).get("code").asString());
            assertFalse(response.getContentAsString().contains("databasechangelog"));
        }
        assertNull(row(login.credential()).get("family_revoked")); assertEquals(1, generations(login.family()));
    }

    Connection lock(UUID family) throws Exception {
        var connection = DriverManager.getConnection(DATABASE.getJdbcUrl(), "team_ai_app", APP_PASSWORD);
        connection.setAutoCommit(false);
        try (var statement = connection.prepareStatement("select id from refresh_token_families where id=? for update")) {
            statement.setObject(1, family); statement.executeQuery().close();
        }
        return connection;
    }
    int pid(Connection connection) throws Exception {
        try (var statement = connection.createStatement(); var result = statement.executeQuery("select pg_backend_pid()")) { result.next(); return result.getInt(1); }
    }
    void awaitWaiters(int blocker, int expected) throws Exception {
        try (var observer = DriverManager.getConnection(DATABASE.getJdbcUrl(), DATABASE.getUsername(), DATABASE.getPassword());
             var query = observer.prepareStatement("""
                     with recursive blocked(pid) as (
                       select pid from pg_stat_activity where ? = any(pg_blocking_pids(pid))
                       union
                       select p.pid from pg_stat_activity p join blocked b on b.pid = any(pg_blocking_pids(p.pid))
                     ) select count(*) from blocked
                     """)) {
            query.setInt(1, blocker); long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
            do {
                try (var result = query.executeQuery()) { result.next(); if (result.getInt(1) >= expected) return; }
                Thread.sleep(20);
            } while (System.nanoTime() < deadline);
            fail("Requests did not reach the expected PostgreSQL family lock wait");
        }
    }

    @Test void concurrentSameTokenHasOneWinnerAndCommittedReplayRevocation() throws Exception {
        var login = login(); var csrf = csrf();
        try (var pool = Executors.newFixedThreadPool(2); var held = lock(login.family())) {
            int blocker = pid(held);
            var first = pool.submit(() -> mvc.perform(command("refresh", login.credential(), csrf)).andReturn().getResponse());
            var second = pool.submit(() -> mvc.perform(command("refresh", login.credential(), csrf)).andReturn().getResponse());
            try { awaitWaiters(blocker, 2); } finally { held.commit(); }
            var a = first.get(15, TimeUnit.SECONDS); var b = second.get(15, TimeUnit.SECONDS);
            assertEquals(Set.of(200, 401), Set.of(a.getStatus(), b.getStatus()));
            var winner = a.getStatus() == 200 ? a : b;
            assertNotNull(row(login.credential()).get("family_revoked")); assertEquals(2, generations(login.family()));
            invalid(refresh(winner.getCookie("refresh_token").getValue()));
        }
    }

    @Test void currentGenerationAndOldReplayContendOnTheSameFamily() throws Exception {
        var login = login(); var next = refresh(login.credential()).getCookie("refresh_token").getValue(); var csrf = csrf();
        try (var pool = Executors.newFixedThreadPool(2); var held = lock(login.family())) {
            var rotation = pool.submit(() -> mvc.perform(command("refresh", next, csrf)).andReturn().getResponse());
            var replay = pool.submit(() -> mvc.perform(command("refresh", login.credential(), csrf)).andReturn().getResponse());
            try { awaitWaiters(pid(held), 2); } finally { held.commit(); }
            invalid(replay.get(15, TimeUnit.SECONDS)); var rotated = rotation.get(15, TimeUnit.SECONDS);
            assertTrue(rotated.getStatus() == 200 || rotated.getStatus() == 401);
            assertNotNull(row(next).get("family_revoked")); invalid(refresh(next));
            if (rotated.getStatus() == 200) invalid(refresh(rotated.getCookie("refresh_token").getValue()));
        }
    }

    @Test void independentFamiliesCanRotateWhileAnotherFamilyIsLocked() throws Exception {
        var first = login(); var second = login(first.email()); var csrf = csrf();
        try (var pool = Executors.newFixedThreadPool(2); var held = lock(first.family())) {
            var blocked = pool.submit(() -> mvc.perform(command("refresh", first.credential(), csrf)).andReturn().getResponse());
            try {
                awaitWaiters(pid(held), 1);
                var independent = pool.submit(() -> mvc.perform(command("refresh", second.credential(), csrf)).andReturn().getResponse());
                assertEquals(200, independent.get(10, TimeUnit.SECONDS).getStatus()); assertFalse(blocked.isDone());
            } finally { held.commit(); }
            assertEquals(200, blocked.get(10, TimeUnit.SECONDS).getStatus());
            assertNull(row(first.credential()).get("family_revoked")); assertNull(row(second.credential()).get("family_revoked"));
        }
    }

    @Test void refreshRechecksClockAfterWaitingForFamilyLockAtReadCommitted() throws Exception {
        var login = login(); var now = new java.util.concurrent.atomic.AtomicReference<>(clock.instant());
        Clock controlled = new Clock() {
            public ZoneId getZone() { return ZoneOffset.UTC; }
            public Clock withZone(ZoneId zone) { return this; }
            public Instant instant() { return now.get(); }
        };
        var observed = new RefreshSessionStore(jdbc) {
            @Override public Generation generation(UUID family, byte[] digest) {
                assertEquals("read committed", jdbc.queryForObject("show transaction_isolation", String.class));
                return super.generation(family, digest);
            }
        };
        var service = new RefreshSessionService(observed, users, signer, limits, controlled, manager);
        try (var pool = Executors.newSingleThreadExecutor(); var held = lock(login.family())) {
            var pending = pool.submit(() -> service.refresh(login.credential()));
            try { awaitWaiters(pid(held), 1); now.set(login.expires()); } finally { held.commit(); }
            assertNull(pending.get(10, TimeUnit.SECONDS).response()); assertEquals(1, generations(login.family()));
        }
    }

    @Test void rateLimitFollowsFamilyAcrossRotationsButNeverSuppressesReplayOrLogout() throws Exception {
        var login = login(); String current = login.credential(); var csrf = csrf();
        for (int i = 0; i < 30; i++) {
            var response = mvc.perform(command("refresh", current, csrf)).andReturn().getResponse(); assertEquals(200, response.getStatus());
            current = response.getCookie("refresh_token").getValue();
        }
        var limited = refresh(current); assertEquals(429, limited.getStatus()); assertNotNull(limited.getHeader("Retry-After"));
        assertNull(limited.getCookie("refresh_token")); assertNull(row(current).get("consumed_at"));
        invalid(refresh(login.credential())); assertNotNull(row(current).get("family_revoked"));
        assertEquals(204, mvc.perform(command("logout", current, csrf())).andReturn().getResponse().getStatus());
        var other = login(); assertEquals(200, refresh(other.credential()).getStatus());
    }
}

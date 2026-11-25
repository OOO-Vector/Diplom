package com.teamai.orchestrator.core.application;

import com.teamai.orchestrator.core.domain.User;
import com.teamai.orchestrator.core.persistence.RefreshSessionStore;
import com.teamai.orchestrator.core.persistence.RefreshSessionStore.Family;
import com.teamai.orchestrator.core.persistence.RefreshSessionStore.Generation;
import com.teamai.orchestrator.core.persistence.UserRepository;
import com.teamai.orchestrator.infrastructure.security.AccessTokenIssuer;
import com.teamai.orchestrator.infrastructure.security.RefreshRateLimiter;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class RefreshSessionServiceTests {
    private final Instant now = Instant.parse("2026-01-01T10:00:00Z");
    private final Instant issued = now.minusSeconds(300);
    private final Instant expires = now.plusSeconds(300);
    private final User user = new User("user@example.invalid", "User", "fixture", issued);
    private final UUID familyId = UUID.randomUUID();
    private final UUID generationId = UUID.randomUUID();
    private final String credential = RefreshTokens.generate();
    private final byte[] digest = RefreshTokens.digest(credential).orElseThrow();
    private final RefreshSessionStore sessions = mock(RefreshSessionStore.class);
    private final UserRepository users = mock(UserRepository.class);
    private final AccessTokenIssuer tokens = mock(AccessTokenIssuer.class);
    private final RefreshRateLimiter limits = mock(RefreshRateLimiter.class);
    private final PlatformTransactionManager manager = mock(PlatformTransactionManager.class);
    private final RefreshSessionService service = new RefreshSessionService(
            sessions, users, tokens, limits, Clock.fixed(now, ZoneOffset.UTC), manager);

    @Test
    void malformedCredentialSkipsTransactionsAndPersistence() {
        assertInvalid(service.refresh("invalid"));
        service.logout("invalid");

        verifyNoInteractions(manager, sessions, users, tokens, limits);
    }

    @Test
    void unknownCredentialNeitherRefreshesNorRevokes() {
        when(manager.getTransaction(any(TransactionDefinition.class))).thenReturn(new SimpleTransactionStatus());
        when(sessions.lockFamily(digest)).thenReturn(Optional.empty());

        assertInvalid(service.refresh(credential));
        service.logout(credential);

        verify(sessions, never()).revoke(any(), any());
        verifyNoInteractions(users, tokens, limits);
    }

    @Test
    void validRefreshRotatesCredentialAndPreservesAbsoluteExpiry() {
        var family = new Family(familyId, user.getId(), issued, expires, null);
        var generation = new Generation(generationId, issued, null, null);
        givenSession(family, generation);
        when(users.findById(user.getId())).thenReturn(Optional.of(user));
        when(tokens.issue(user.getId())).thenReturn("issued-access-token");

        var refreshed = service.refresh(credential);

        assertNotEquals(credential, refreshed.credential());
        assertEquals(expires, refreshed.expiresAt());
        assertEquals("issued-access-token", refreshed.response().accessToken());
        assertEquals(user.getId(), refreshed.response().user().id());
        assertNull(refreshed.replayedFamily());
        var replacementDigest = ArgumentCaptor.forClass(byte[].class);
        verify(sessions).rotate(eq(family), eq(generation), replacementDigest.capture(), eq(now));
        assertArrayEquals(RefreshTokens.digest(refreshed.credential()).orElseThrow(), replacementDigest.getValue());
        verify(limits).acquire(familyId);
    }

    @Test
    void consumedGenerationRevokesFamilyBeforeReturningInvalidResult() {
        var family = new Family(familyId, user.getId(), issued, expires, null);
        givenSession(family, new Generation(generationId, issued, now.minusSeconds(1), null));

        var result = service.refresh(credential);

        assertEquals(familyId, result.replayedFamily());
        assertNull(result.response());
        verify(sessions).revoke(family, now);
        verifyNoInteractions(users, tokens, limits);
    }

    @ParameterizedTest
    @CsvSource({
            "true, false, 300, -300",
            "false, true, 300, -300",
            "false, false, 0, -300",
            "false, false, 300, 1"
    })
    void rejectsRevokedExpiredOrFutureSessions(boolean familyRevoked, boolean generationRevoked,
                                               long expiryOffset, long issuanceOffset) {
        givenSession(new Family(familyId, user.getId(), issued, now.plusSeconds(expiryOffset), familyRevoked ? now : null),
                new Generation(generationId, now.plusSeconds(issuanceOffset), null, generationRevoked ? now : null));

        assertInvalid(service.refresh(credential));

        verify(sessions, never()).rotate(any(), any(), any(), any());
        verifyNoInteractions(users, tokens, limits);
    }

    @Test
    void disabledAccountCannotRefreshAnOtherwiseValidSession() {
        givenSession(new Family(familyId, user.getId(), issued, expires, null),
                new Generation(generationId, issued, null, null));
        when(users.findById(user.getId())).thenReturn(Optional.of(mock(User.class)));

        assertInvalid(service.refresh(credential));

        verify(sessions, never()).rotate(any(), any(), any(), any());
        verifyNoInteractions(tokens, limits);
    }

    @Test
    void logoutRevokesFamilyEvenWithAnExpiredConsumedGeneration() {
        var family = new Family(familyId, user.getId(), issued, now.minusSeconds(1), null);
        givenSession(family, new Generation(generationId, issued, now.minusSeconds(10), null));

        service.logout(credential);

        verify(sessions).revoke(family, now);
        verifyNoInteractions(users, tokens, limits);
    }

    private void givenSession(Family family, Generation generation) {
        when(manager.getTransaction(any(TransactionDefinition.class))).thenReturn(new SimpleTransactionStatus());
        when(sessions.lockFamily(digest)).thenReturn(Optional.of(family));
        when(sessions.generation(familyId, digest)).thenReturn(generation);
    }

    private static void assertInvalid(RefreshSessionService.Result result) {
        assertNull(result.response());
        assertNull(result.credential());
        assertNull(result.replayedFamily());
    }
}

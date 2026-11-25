package com.teamai.orchestrator.core.application;

import com.teamai.orchestrator.core.api.LoginRequest;
import com.teamai.orchestrator.core.domain.User;
import com.teamai.orchestrator.core.persistence.RefreshSessionStore;
import com.teamai.orchestrator.core.persistence.UserRepository;
import com.teamai.orchestrator.infrastructure.security.AccessTokenIssuer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.ArgumentCaptor;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class LoginServiceTests {
    private final Instant now = Instant.parse("2026-01-01T10:00:00Z");
    private final Instant expires = Instant.parse("2026-01-08T10:00:00Z");
    private final LoginRequest request = new LoginRequest("user@example.invalid", "fixture password");
    private final User user = new User(request.email(), "Current User", "encoded", now);
    private final UserRepository users = mock(UserRepository.class);
    private final RefreshSessionStore sessions = mock(RefreshSessionStore.class);
    private final PasswordEncoder passwords = mock(PasswordEncoder.class);
    private final AccessTokenIssuer tokens = mock(AccessTokenIssuer.class);
    private final PlatformTransactionManager manager = mock(PlatformTransactionManager.class);
    private LoginService service;

    @BeforeEach
    void setUp() {
        when(passwords.encode(anyString())).thenReturn("dummy-encoded");
        service = new LoginService(users, sessions, passwords, tokens, new TransactionTemplate(manager),
                Clock.fixed(now, ZoneOffset.UTC));
    }

    @Test
    void validLoginIssuesTokensAndStoresRefreshDigestWithAbsoluteExpiry() {
        allowInitialCredentials();
        when(users.findById(user.getId())).thenReturn(Optional.of(user));
        when(tokens.issue(user.getId())).thenReturn("fixture access token");

        var login = service.login(request);

        assertEquals("fixture access token", login.response().accessToken());
        assertEquals(user.getId(), login.response().user().id());
        assertEquals(expires, login.expiresAt());
        var digest = ArgumentCaptor.forClass(byte[].class);
        verify(sessions).insert(eq(user.getId()), digest.capture(), eq(now), eq(expires));
        assertArrayEquals(RefreshTokens.digest(login.refreshToken()).orElseThrow(), digest.getValue());
    }

    @Test
    void incorrectPasswordRejectsActiveAccount() {
        when(users.findByEmail(request.email())).thenReturn(Optional.of(user));

        assertInvalidCredentials();
        verify(passwords).matches(request.password(), user.getPasswordHash());
        verifyNoInteractions(manager);
    }

    @Test
    void unknownAccountPerformsPasswordCheckAndReturnsSameFailure() {
        when(passwords.matches(request.password(), "dummy-encoded")).thenReturn(true);

        assertInvalidCredentials();
        verify(passwords).matches(request.password(), "dummy-encoded");
        verifyNoInteractions(manager);
    }

    @Test
    void inactiveAccountIsRejectedEvenWithMatchingPassword() {
        var inactive = inactiveUser();
        when(users.findByEmail(request.email())).thenReturn(Optional.of(inactive));
        when(passwords.matches(request.password(), user.getPasswordHash())).thenReturn(true);

        assertInvalidCredentials();
        verifyNoInteractions(manager);
    }

    private enum AccountChange { DELETED, DISABLED, PASSWORD_CHANGED }

    @ParameterizedTest
    @EnumSource(AccountChange.class)
    void detectsAccountChangesBeforeIssuingCredentials(AccountChange change) {
        allowInitialCredentials();
        Optional<User> current = switch (change) {
            case DELETED -> Optional.empty();
            case DISABLED -> Optional.of(inactiveUser());
            case PASSWORD_CHANGED -> Optional.of(new User(request.email(), "Current User", "new hash", now));
        };
        when(users.findById(user.getId())).thenReturn(current);

        assertInvalidCredentials();
    }

    private void allowInitialCredentials() {
        when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(users.findByEmail(request.email())).thenReturn(Optional.of(user));
        when(passwords.matches(request.password(), user.getPasswordHash())).thenReturn(true);
    }

    private User inactiveUser() {
        var inactive = mock(User.class);
        when(inactive.getPasswordHash()).thenReturn(user.getPasswordHash());
        return inactive;
    }

    private void assertInvalidCredentials() {
        assertEquals("Invalid credentials",
                assertThrows(BadCredentialsException.class, () -> service.login(request)).getMessage());
        verifyNoInteractions(sessions, tokens);
    }
}

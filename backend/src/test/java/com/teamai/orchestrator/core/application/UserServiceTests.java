package com.teamai.orchestrator.core.application;

import com.teamai.orchestrator.core.api.RegisterRequest;
import com.teamai.orchestrator.core.api.UserResponse;
import com.teamai.orchestrator.core.domain.User;
import com.teamai.orchestrator.core.persistence.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class UserServiceTests {
    private final Instant now = Instant.parse("2026-01-01T10:00:00.123456789Z");
    private final UserRepository users = mock(UserRepository.class);
    private final PasswordEncoder passwords = mock(PasswordEncoder.class);
    private final PlatformTransactionManager manager = mock(PlatformTransactionManager.class);
    private final UserService service = new UserService(users, passwords, Clock.fixed(now, ZoneOffset.UTC),
            new TransactionTemplate(manager));

    @Test
    void registrationPersistsEncodedPasswordAndReturnsSavedAccount() {
        var request = new RegisterRequest("user@example.invalid", "New User", " password with whitespace ");
        when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(passwords.encode(request.password())).thenReturn("encoded");
        when(users.saveAndFlush(any(User.class))).thenAnswer(invocation -> {
            User saved = invocation.getArgument(0);
            assertEquals("encoded", saved.getPasswordHash());
            assertEquals(request.email(), saved.getEmail());
            assertEquals(request.displayName(), saved.getDisplayName());
            assertEquals(Instant.parse("2026-01-01T10:00:00.123456Z"), saved.getCreatedAt());
            return saved;
        });

        var registered = service.register(request);

        assertEquals(request.email(), registered.email());
        assertEquals(request.displayName(), registered.displayName());
        assertTrue(registered.isActive());
    }

    @Test
    void registrationPropagatesPersistenceFailure() {
        var request = new RegisterRequest("user@example.invalid", "New User", "fixture password");
        var failure = new DataIntegrityViolationException("fixture conflict");
        when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(passwords.encode(request.password())).thenReturn("encoded");
        when(users.saveAndFlush(any(User.class))).thenThrow(failure);

        assertSame(failure, assertThrows(DataIntegrityViolationException.class,
                () -> service.register(request)));
    }

    @Test
    void currentReturnsActiveAccount() {
        var user = new User("user@example.invalid", "Current User", "fixture", now);
        when(users.findById(user.getId())).thenReturn(Optional.of(user));

        assertEquals(UserResponse.from(user), service.current(user.getId().toString()));
    }

    @Test
    void currentRejectsMalformedSubjectBeforeLookup() {
        assertThrows(BadCredentialsException.class, () -> service.current("invalid"));

        verifyNoInteractions(users);
    }

    @Test
    void currentRejectsMissingAndInactiveAccounts() {
        var missing = UUID.randomUUID();
        var inactive = UUID.randomUUID();
        when(users.findById(inactive)).thenReturn(Optional.of(mock(User.class)));

        assertEquals("Authentication required",
                assertThrows(BadCredentialsException.class, () -> service.current(missing.toString())).getMessage());
        assertEquals("Authentication required",
                assertThrows(BadCredentialsException.class, () -> service.current(inactive.toString())).getMessage());
    }
}

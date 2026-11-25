package com.teamai.orchestrator.core.application;

import com.teamai.orchestrator.core.api.RegisterRequest;
import com.teamai.orchestrator.core.api.UserResponse;
import com.teamai.orchestrator.core.domain.User;
import com.teamai.orchestrator.core.persistence.UserRepository;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

@Service
public class UserService {
    private final UserRepository users;
    private final PasswordEncoder passwords;
    private final Clock clock;
    private final TransactionTemplate transactions;
    public UserService(UserRepository users, PasswordEncoder passwords, Clock clock, TransactionTemplate transactions) {
        this.users = users; this.passwords = passwords; this.clock = clock; this.transactions = transactions;
    }
    public UserResponse register(RegisterRequest request) {
        String hash = passwords.encode(request.password());
        return transactions.execute(status -> UserResponse.from(users.saveAndFlush(new User(
                request.email(), request.displayName(), hash, clock.instant().truncatedTo(ChronoUnit.MICROS)))));
    }
    public UserResponse current(String subject) {
        try {
            return users.findById(UUID.fromString(subject)).filter(User::isActive)
                    .map(UserResponse::from).orElseThrow(() -> new BadCredentialsException("Authentication required"));
        } catch (IllegalArgumentException exception) {
            throw new BadCredentialsException("Authentication required");
        }
    }
}

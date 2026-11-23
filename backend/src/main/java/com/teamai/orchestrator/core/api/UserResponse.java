package com.teamai.orchestrator.core.api;

import com.teamai.orchestrator.core.domain.User;
import java.time.Instant;
import java.util.UUID;

public record UserResponse(UUID id, String email, String displayName, boolean isActive,
                           Instant createdAt, Instant updatedAt) {
    public static UserResponse from(User user) {
        return new UserResponse(user.getId(), user.getEmail(), user.getDisplayName(),
                user.isActive(), user.getCreatedAt(), user.getUpdatedAt());
    }
}

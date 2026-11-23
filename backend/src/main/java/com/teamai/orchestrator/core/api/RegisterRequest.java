package com.teamai.orchestrator.core.api;

import jakarta.validation.constraints.*;

public record RegisterRequest(
        @NotBlank @Email @UnicodeLength(max = 254) String email,
        @NotBlank @Pattern(regexp = "[^\\x00]*") @UnicodeLength(min = 1, max = 100) String displayName,
        @NotNull @UnicodeLength(min = 12, max = 128, maxBytes = 512) String password) {
    public RegisterRequest {
        email = email == null ? null : email.strip();
        displayName = displayName == null ? null : displayName.strip();
    }
    @Override public String toString() { return "RegisterRequest[redacted]"; }
}

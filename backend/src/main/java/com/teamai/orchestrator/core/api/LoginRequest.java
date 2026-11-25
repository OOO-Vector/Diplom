package com.teamai.orchestrator.core.api;

import jakarta.validation.constraints.*;

public record LoginRequest(@NotBlank @Email @UnicodeLength(max = 254) String email,
                           @NotNull @UnicodeLength(min = 1, max = 128, maxBytes = 512) String password) {
    public LoginRequest { email = email == null ? null : email.strip(); }
    @Override public String toString() { return "LoginRequest[redacted]"; }
}

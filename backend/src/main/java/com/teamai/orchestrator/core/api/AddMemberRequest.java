package com.teamai.orchestrator.core.api;

import jakarta.validation.constraints.*;

public record AddMemberRequest(@NotBlank @Email @UnicodeLength(max = 254) String email) {
    public AddMemberRequest { email = email == null ? null : email.strip(); }
}

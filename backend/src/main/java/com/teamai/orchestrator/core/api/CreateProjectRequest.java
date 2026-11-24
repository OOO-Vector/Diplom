package com.teamai.orchestrator.core.api;

import jakarta.validation.constraints.*;

public record CreateProjectRequest(@NotBlank @UnicodeLength(min = 1, max = 150) @Pattern(regexp = "[^\\x00]*") String name,
                                   @UnicodeLength(max = 4000) @Pattern(regexp = "[^\\x00]*") String description) {
    public CreateProjectRequest { name = name == null ? null : name.strip(); }
}

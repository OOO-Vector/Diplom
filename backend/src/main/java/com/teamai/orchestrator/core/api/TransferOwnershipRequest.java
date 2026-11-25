package com.teamai.orchestrator.core.api;

import jakarta.validation.constraints.*;
import java.util.UUID;

public record TransferOwnershipRequest(@NotNull @Pattern(regexp = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}") String newOwnerUserId) {
    public UUID target() { return UUID.fromString(newOwnerUserId); }
}

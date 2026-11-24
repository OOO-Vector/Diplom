package com.teamai.orchestrator.core.api;

import java.time.Instant;
import java.util.UUID;

public record MemberResponse(UUID userId, String displayName, String role, Instant joinedAt) {}

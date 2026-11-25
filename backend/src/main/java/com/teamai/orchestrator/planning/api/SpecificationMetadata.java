package com.teamai.orchestrator.planning.api;

import java.time.Instant;
import java.util.UUID;

public record SpecificationMetadata(UUID id, UUID projectId, UUID uploadedBy, int version, String title,
                                    String originalFilename, String status, Instant createdAt) {}

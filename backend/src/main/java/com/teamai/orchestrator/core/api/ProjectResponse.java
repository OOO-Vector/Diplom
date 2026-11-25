package com.teamai.orchestrator.core.api;

import com.teamai.orchestrator.core.domain.Project;
import java.time.Instant;
import java.util.UUID;

public record ProjectResponse(UUID id, String name, String description, UUID createdBy, String status,
                              String myRole, Instant createdAt, Instant updatedAt) {
    public static ProjectResponse from(Project project, String role) {
        return new ProjectResponse(project.getId(), project.getName(), project.getDescription(), project.getCreatedBy(),
                project.getStatus(), role, project.getCreatedAt(), project.getUpdatedAt());
    }
}

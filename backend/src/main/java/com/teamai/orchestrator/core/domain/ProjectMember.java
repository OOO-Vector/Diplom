package com.teamai.orchestrator.core.domain;

import jakarta.persistence.*;
import java.io.Serializable;
import java.time.Instant;
import java.util.*;

@Entity
@Table(name = "project_members")
public class ProjectMember {
    @Embeddable
    public static class Id implements Serializable {
        @Column(name = "project_id") private UUID projectId;
        @Column(name = "user_id") private UUID userId;
        protected Id() {}
        public Id(UUID projectId, UUID userId) { this.projectId = projectId; this.userId = userId; }
        public UUID getProjectId() { return projectId; }
        public UUID getUserId() { return userId; }
        @Override public boolean equals(Object other) {
            return other instanceof Id id && Objects.equals(projectId, id.projectId) && Objects.equals(userId, id.userId);
        }
        @Override public int hashCode() { return Objects.hash(projectId, userId); }
    }
    @EmbeddedId private Id id;
    @Column(nullable = false, length = 20) private String role;
    @Column(name = "joined_at", nullable = false, updatable = false) private Instant joinedAt;
    protected ProjectMember() {}
    public ProjectMember(UUID project, UUID user, String role, Instant now) {
        id = new Id(project, user); this.role = role; joinedAt = now;
    }
    public Id getId() { return id; }
    public String getRole() { return role; }
    public Instant getJoinedAt() { return joinedAt; }
    public void demote() { role = "member"; }
    public void promote() { role = "owner"; }
}

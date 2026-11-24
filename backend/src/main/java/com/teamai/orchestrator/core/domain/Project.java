package com.teamai.orchestrator.core.domain;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "projects")
public class Project {
    @Id private UUID id;
    @Column(nullable = false, length = 150) private String name;
    @Column(columnDefinition = "text") private String description;
    @Column(name = "created_by", nullable = false, updatable = false) private UUID createdBy;
    @Column(nullable = false, length = 20) private String status;
    @Column(name = "created_at", nullable = false, updatable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    protected Project() {}
    public Project(UUID creator, String name, String description, Instant now) {
        id = UUID.randomUUID(); createdBy = creator; this.name = name; this.description = description;
        status = "active"; createdAt = now; updatedAt = now;
    }
    public UUID getId() { return id; }
    public String getName() { return name; }
    public String getDescription() { return description; }
    public UUID getCreatedBy() { return createdBy; }
    public String getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void rename(String name) { this.name = name; }
    public void describe(String description) { this.description = description; }
    public void touch(Instant now) { updatedAt = now.isBefore(updatedAt) ? updatedAt : now; }
    public void archive(Instant now) { status = "archived"; touch(now); }
}

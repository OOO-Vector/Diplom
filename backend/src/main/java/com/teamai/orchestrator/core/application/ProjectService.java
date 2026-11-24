package com.teamai.orchestrator.core.application;

import com.teamai.orchestrator.core.api.*;
import com.teamai.orchestrator.core.domain.*;
import com.teamai.orchestrator.core.persistence.*;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.*;

@Service
@Transactional(isolation = Isolation.READ_COMMITTED)
public class ProjectService {
    private final ProjectRepository projects;
    private final ProjectMemberRepository members;
    private final ProjectAccess access;
    private final Clock clock;
    public ProjectService(ProjectRepository projects, ProjectMemberRepository members, ProjectAccess access, Clock clock) {
        this.projects = projects; this.members = members; this.access = access; this.clock = clock;
    }
    public ProjectResponse create(CreateProjectRequest request) {
        var actor = access.actor(); var now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        var project = projects.saveAndFlush(new Project(actor, request.name(), request.description(), now));
        // Newly inserted row is already exclusively owned by this transaction; initial owner is committed with it.
        members.saveAndFlush(new ProjectMember(project.getId(), actor, "owner", now));
        return ProjectResponse.from(project, "owner");
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PageResponse<ProjectResponse> list(int page, int size, String status) {
        var paging = page(page, size);
        if (status != null && !Set.of("active", "archived").contains(status)) throw CoreException.invalid();
        var actor = access.actor(); long total = projects.countVisible(actor, status);
        var items = paging.getOffset() >= total ? List.<ProjectResponse>of() : projects.visible(actor, status, paging);
        return PageResponse.of(items, page, size, total);
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public ProjectResponse get(UUID id) {
        var scope = access.member(id, access.actor(), false);
        return ProjectResponse.from(scope.project(), scope.membership().getRole());
    }
    public ProjectResponse update(UUID id, UpdateProjectRequest request) {
        request.validatePresence();
        var scope = access.owner(id, access.actor()); var project = scope.project();
        if (ProjectAccess.archived(project)) throw CoreException.archived();
        if (request.hasName()) project.rename(request.name());
        if (request.hasDescription()) project.describe(request.description());
        project.touch(clock.instant().truncatedTo(ChronoUnit.MICROS));
        return ProjectResponse.from(project, scope.membership().getRole());
    }
    public ProjectResponse archive(UUID id) {
        var scope = access.owner(id, access.actor()); var project = scope.project();
        if (!ProjectAccess.archived(project)) project.archive(clock.instant().truncatedTo(ChronoUnit.MICROS));
        return ProjectResponse.from(project, scope.membership().getRole());
    }
    public static PageRequest page(int page, int size) {
        if (page < 0 || size < 1 || size > 100) throw CoreException.invalid();
        return PageRequest.of(page, size);
    }
}

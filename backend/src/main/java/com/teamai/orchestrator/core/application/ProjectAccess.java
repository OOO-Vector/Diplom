package com.teamai.orchestrator.core.application;

import com.teamai.orchestrator.core.domain.*;
import com.teamai.orchestrator.core.persistence.*;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import java.util.UUID;

@Component
public class ProjectAccess {
    private final ProjectRepository projects;
    private final ProjectMemberRepository members;
    private final UserService users;
    public ProjectAccess(ProjectRepository projects, ProjectMemberRepository members, UserService users) {
        this.projects = projects; this.members = members; this.users = users;
    }
    public UUID actor() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (!(authentication instanceof JwtAuthenticationToken) || !authentication.isAuthenticated())
            throw new BadCredentialsException("Authentication required");
        return users.current(authentication.getName()).id();
    }
    public record Scope(Project project, ProjectMember membership) {}
    public Scope member(UUID projectId, UUID actor, boolean lock) {
        var project = (lock ? projects.lock(projectId) : projects.findById(projectId)).orElseThrow(CoreException::missing);
        // No role/membership is loaded before the project lock for a mutation.
        var member = members.findById(new ProjectMember.Id(projectId, actor)).orElseThrow(CoreException::missing);
        return new Scope(project, member);
    }
    public Scope owner(UUID projectId, UUID actor) {
        var scope = member(projectId, actor, true);
        if (!scope.membership().getRole().equals("owner")) throw CoreException.forbidden();
        return scope;
    }
    public static boolean archived(Project project) { return project.getStatus().equals("archived"); }
}

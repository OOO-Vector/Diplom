package com.teamai.orchestrator.core.application;

import com.teamai.orchestrator.core.api.*;
import com.teamai.orchestrator.core.domain.ProjectMember;
import com.teamai.orchestrator.core.persistence.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.*;

@Service
@Transactional(isolation = Isolation.READ_COMMITTED)
public class MembershipService {
    private final ProjectAccess access;
    private final ProjectMemberRepository members;
    private final UserRepository users;
    private final Clock clock;
    public MembershipService(ProjectAccess access, ProjectMemberRepository members, UserRepository users, Clock clock) {
        this.access = access; this.members = members; this.users = users; this.clock = clock;
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PageResponse<MemberResponse> list(UUID project, int page, int size) {
        var paging = ProjectService.page(page, size);
        access.member(project, access.actor(), false);
        long total = members.countInProject(project);
        var items = paging.getOffset() >= total ? List.<MemberResponse>of() : members.page(project, paging);
        return PageResponse.of(items, page, size, total);
    }
    public MemberResponse add(UUID project, AddMemberRequest request) {
        ProjectAccess.Scope scope;
        try { scope = access.owner(project, access.actor()); }
        catch (CoreException exception) {
            if (exception.status() == 404) throw unavailable();
            throw exception;
        }
        if (ProjectAccess.archived(scope.project())) throw membershipConflict();
        var user = users.findByEmail(request.email()).filter(u -> u.isActive()).orElseThrow(MembershipService::unavailable);
        if (members.existsById(new ProjectMember.Id(project, user.getId()))) throw membershipConflict();
        var member = members.saveAndFlush(new ProjectMember(project, user.getId(), "member", clock.instant().truncatedTo(ChronoUnit.MICROS)));
        return new MemberResponse(user.getId(), user.getDisplayName(), member.getRole(), member.getJoinedAt());
    }
    public void remove(UUID project, UUID user) {
        var scope = access.owner(project, access.actor());
        if (ProjectAccess.archived(scope.project())) throw membershipConflict();
        var member = members.findById(new ProjectMember.Id(project, user)).orElseThrow(CoreException::missing);
        if (member.getRole().equals("owner")) throw membershipConflict();
        members.delete(member);
        members.flush();
    }
    public ProjectResponse transfer(UUID project, UUID target) {
        var actor = access.actor(); var scope = access.owner(project, actor);
        if (ProjectAccess.archived(scope.project()) || actor.equals(target)) throw ownershipConflict();
        var successor = members.findById(new ProjectMember.Id(project, target)).orElseThrow(MembershipService::ownershipConflict);
        if (users.findById(target).filter(u -> u.isActive()).isEmpty()) throw ownershipConflict();
        scope.membership().demote();
        members.flush(); // Free the immediate partial unique owner index before promoting the successor.
        successor.promote();
        members.flush();
        return ProjectResponse.from(scope.project(), "member");
    }
    private static CoreException unavailable() { return new CoreException(404, "USER_OR_PROJECT_NOT_FOUND", "Account or project unavailable"); }
    private static CoreException membershipConflict() { return new CoreException(409, "MEMBERSHIP_CONFLICT", "Membership or project state conflict"); }
    private static CoreException ownershipConflict() { return new CoreException(409, "OWNERSHIP_CONFLICT", "Target or project state prevents transfer"); }
}

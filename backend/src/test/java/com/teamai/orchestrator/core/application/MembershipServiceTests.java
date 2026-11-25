package com.teamai.orchestrator.core.application;

import com.teamai.orchestrator.core.api.AddMemberRequest;
import com.teamai.orchestrator.core.domain.Project;
import com.teamai.orchestrator.core.domain.ProjectMember;
import com.teamai.orchestrator.core.domain.User;
import com.teamai.orchestrator.core.persistence.ProjectMemberRepository;
import com.teamai.orchestrator.core.persistence.UserRepository;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class MembershipServiceTests {
    private final Instant now = Instant.parse("2026-01-01T10:00:00Z");
    private final UUID ownerId = UUID.randomUUID();
    private final Project project = new Project(ownerId, "Project", null, now);
    private final ProjectMember owner = new ProjectMember(project.getId(), ownerId, "owner", now);
    private final User candidate = new User("member@example.invalid", "Member", "fixture", now);
    private final ProjectMember.Id candidateId = new ProjectMember.Id(project.getId(), candidate.getId());
    private final ProjectAccess access = mock(ProjectAccess.class);
    private final ProjectMemberRepository members = mock(ProjectMemberRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final MembershipService service = new MembershipService(access, members, users, Clock.fixed(now, ZoneOffset.UTC));

    @Test
    void addsActiveAccountAsMember() {
        allowOwner();
        when(users.findByEmail(candidate.getEmail())).thenReturn(Optional.of(candidate));
        when(members.saveAndFlush(any(ProjectMember.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var added = service.add(project.getId(), new AddMemberRequest(candidate.getEmail()));

        assertEquals(candidate.getId(), added.userId());
        assertEquals("member", added.role());
        assertEquals(now, added.joinedAt());
    }

    @Test
    void rejectsDuplicateMembershipWithoutSaving() {
        allowOwner();
        when(users.findByEmail(candidate.getEmail())).thenReturn(Optional.of(candidate));
        when(members.existsById(candidateId)).thenReturn(true);

        var error = assertThrows(CoreException.class,
                () -> service.add(project.getId(), new AddMemberRequest(candidate.getEmail())));

        assertEquals("MEMBERSHIP_CONFLICT", error.code());
        verify(members, never()).saveAndFlush(any());
    }

    @Test
    void archivedProjectRejectsAllMembershipChanges() {
        allowOwner();
        project.archive(now);

        assertEquals("MEMBERSHIP_CONFLICT", assertThrows(CoreException.class,
                () -> service.add(project.getId(), new AddMemberRequest(candidate.getEmail()))).code());
        assertEquals("MEMBERSHIP_CONFLICT", assertThrows(CoreException.class,
                () -> service.remove(project.getId(), candidate.getId())).code());
        assertEquals("OWNERSHIP_CONFLICT", assertThrows(CoreException.class,
                () -> service.transfer(project.getId(), candidate.getId())).code());
        verifyNoInteractions(users, members);
    }

    @Test
    void removesMemberButRejectsRemovingOwner() {
        allowOwner();
        var member = new ProjectMember(project.getId(), candidate.getId(), "member", now);
        when(members.findById(candidateId)).thenReturn(Optional.of(member));
        when(members.findById(new ProjectMember.Id(project.getId(), ownerId))).thenReturn(Optional.of(owner));

        service.remove(project.getId(), candidate.getId());
        assertEquals("MEMBERSHIP_CONFLICT",
                assertThrows(CoreException.class, () -> service.remove(project.getId(), ownerId)).code());

        verify(members).delete(member);
        verify(members, never()).delete(owner);
    }

    @Test
    void transfersOwnershipToAnActiveMember() {
        allowOwner();
        var successor = new ProjectMember(project.getId(), candidate.getId(), "member", now);
        when(members.findById(candidateId)).thenReturn(Optional.of(successor));
        when(users.findById(candidate.getId())).thenReturn(Optional.of(candidate));

        var response = service.transfer(project.getId(), candidate.getId());

        assertEquals("member", response.myRole());
        assertEquals("member", owner.getRole());
        assertEquals("owner", successor.getRole());
        assertEquals(ownerId, response.createdBy());
    }

    @Test
    void rejectsSelfTransferAndTransferToInactiveAccount() {
        allowOwner();
        var successor = new ProjectMember(project.getId(), candidate.getId(), "member", now);
        var inactive = mock(User.class);
        when(members.findById(candidateId)).thenReturn(Optional.of(successor));
        when(users.findById(candidate.getId())).thenReturn(Optional.of(inactive));

        assertEquals("OWNERSHIP_CONFLICT", assertThrows(CoreException.class,
                () -> service.transfer(project.getId(), ownerId)).code());
        assertEquals("OWNERSHIP_CONFLICT", assertThrows(CoreException.class,
                () -> service.transfer(project.getId(), candidate.getId())).code());

        assertEquals("owner", owner.getRole());
        assertEquals("member", successor.getRole());
        verify(members, never()).flush();
    }

    @Test
    void listingPastLastPageReturnsEmptyItemsWithTotal() {
        when(access.actor()).thenReturn(ownerId);
        when(members.countInProject(project.getId())).thenReturn(1L);

        var page = service.list(project.getId(), 1, 1);

        assertTrue(page.items().isEmpty());
        assertEquals(1, page.totalElements());
        verify(access).member(project.getId(), ownerId, false);
        verify(members, never()).page(any(), any());
    }

    private void allowOwner() {
        when(access.actor()).thenReturn(ownerId);
        when(access.owner(project.getId(), ownerId)).thenReturn(new ProjectAccess.Scope(project, owner));
    }
}

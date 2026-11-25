package com.teamai.orchestrator.core.application;

import com.teamai.orchestrator.core.api.CreateProjectRequest;
import com.teamai.orchestrator.core.api.ProjectResponse;
import com.teamai.orchestrator.core.api.UpdateProjectRequest;
import com.teamai.orchestrator.core.domain.Project;
import com.teamai.orchestrator.core.domain.ProjectMember;
import com.teamai.orchestrator.core.persistence.ProjectMemberRepository;
import com.teamai.orchestrator.core.persistence.ProjectRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageRequest;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ProjectServiceTests {
    private final Instant now = Instant.parse("2026-01-01T10:00:00Z");
    private final UUID actor = UUID.randomUUID();
    private final Project project = new Project(actor, "Original", "Description", now.minusSeconds(60));
    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final ProjectMemberRepository members = mock(ProjectMemberRepository.class);
    private final ProjectAccess access = mock(ProjectAccess.class);
    private final ProjectService service = new ProjectService(projects, members, access, Clock.fixed(now, ZoneOffset.UTC));

    @Test
    void createsProjectWithCallerAsOwner() {
        when(access.actor()).thenReturn(actor);
        when(projects.saveAndFlush(any(Project.class))).thenReturn(project);
        when(projects.lock(project.getId())).thenReturn(Optional.of(project));

        var response = service.create(new CreateProjectRequest("New", "Summary"));

        var membership = ArgumentCaptor.forClass(ProjectMember.class);
        verify(members).saveAndFlush(membership.capture());
        assertEquals(new ProjectMember.Id(response.id(), actor), membership.getValue().getId());
        assertEquals("owner", membership.getValue().getRole());
        var created = ArgumentCaptor.forClass(Project.class);
        verify(projects).saveAndFlush(created.capture());
        assertEquals("New", created.getValue().getName());
        assertEquals("Summary", created.getValue().getDescription());
        assertEquals(project.getId(), response.id());
        assertEquals(actor, response.createdBy());
    }

    @Test
    void listingUsesCallerAndStatusAndReturnsRepositoryPage() {
        when(access.actor()).thenReturn(actor);
        var item = ProjectResponse.from(project, "member");
        when(projects.countVisible(actor, "active")).thenReturn(4L);
        when(projects.visible(actor, "active", PageRequest.of(1, 2))).thenReturn(List.of(item));

        var page = service.list(1, 2, "active");

        assertEquals(List.of(item), page.items());
        assertEquals(4, page.totalElements());
        assertEquals(2, page.totalPages());
    }

    @Test
    void rejectsInvalidPagingAndUnknownStatusBeforeRepositoryAccess() {
        assertThrows(CoreException.class, () -> service.list(-1, 10, null));
        assertThrows(CoreException.class, () -> service.list(0, 0, null));
        assertThrows(CoreException.class, () -> service.list(0, 101, null));
        assertThrows(CoreException.class, () -> service.list(0, 100, "unknown"));
        assertEquals(100, ProjectService.page(0, 100).getPageSize());
        verifyNoInteractions(access, projects);
    }

    @Test
    void getUsesMembershipRole() {
        when(access.actor()).thenReturn(actor);
        when(access.member(project.getId(), actor, false)).thenReturn(scope("member"));

        assertEquals(ProjectResponse.from(project, "member"), service.get(project.getId()));
    }

    @Test
    void patchPreservesOmittedDescriptionAndClearsExplicitNull() {
        allowOwner();
        var rename = new UpdateProjectRequest();
        rename.setName("Renamed");
        assertEquals("Description", service.update(project.getId(), rename).description());

        var clearDescription = new UpdateProjectRequest();
        clearDescription.setDescription(null);
        var updated = service.update(project.getId(), clearDescription);

        assertEquals("Renamed", updated.name());
        assertNull(updated.description());
        assertEquals(now, updated.updatedAt());
    }

    @Test
    void rejectsEmptyPatchAndChangesToArchivedProject() {
        assertEquals("VALIDATION_ERROR", assertThrows(CoreException.class,
                () -> service.update(project.getId(), new UpdateProjectRequest())).code());
        allowOwner();
        project.archive(now.minusSeconds(10));
        var request = new UpdateProjectRequest();
        request.setName("Forbidden change");

        assertEquals("PROJECT_ARCHIVED",
                assertThrows(CoreException.class, () -> service.update(project.getId(), request)).code());
        assertEquals("Original", project.getName());
        assertEquals(now.minusSeconds(10), project.getUpdatedAt());
    }

    @Test
    void archivesActiveProject() {
        allowOwner();
        var archived = service.archive(project.getId());
        assertEquals("archived", archived.status());
        assertEquals(now, archived.updatedAt());
    }

    @Test
    void preservesExistingArchiveTimestamp() {
        allowOwner();
        project.archive(now.minusSeconds(10));
        assertEquals(now.minusSeconds(10), service.archive(project.getId()).updatedAt());
    }

    private void allowOwner() {
        when(access.actor()).thenReturn(actor);
        when(access.owner(project.getId(), actor)).thenReturn(scope("owner"));
    }

    private ProjectAccess.Scope scope(String role) {
        return new ProjectAccess.Scope(project, new ProjectMember(project.getId(), actor, role, now));
    }

}

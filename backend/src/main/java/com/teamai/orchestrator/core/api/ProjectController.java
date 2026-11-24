package com.teamai.orchestrator.core.api;

import com.teamai.orchestrator.core.application.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.io.IOException;
import java.net.URI;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/projects")
public class ProjectController {
    private final ProjectService projects;
    public ProjectController(ProjectService projects) { this.projects = projects; }
    @PostMapping
    public ResponseEntity<ProjectResponse> create(@Valid @RequestBody CreateProjectRequest request) {
        var project = projects.create(request);
        return ResponseEntity.created(URI.create("/api/v1/projects/" + project.id())).body(project);
    }
    @GetMapping
    public PageResponse<ProjectResponse> list(@RequestParam(defaultValue = "0") int page,
                                              @RequestParam(defaultValue = "20") int size,
                                              @RequestParam(required = false) String status) { return projects.list(page, size, status); }
    @GetMapping("/{projectId}")
    public ProjectResponse get(@PathVariable UUID projectId) { return projects.get(projectId); }
    @PatchMapping("/{projectId}")
    public ProjectResponse update(@PathVariable UUID projectId, @Valid @RequestBody UpdateProjectRequest request) {
        return projects.update(projectId, request);
    }
    @PostMapping("/{projectId}/archive")
    public ProjectResponse archive(@PathVariable UUID projectId, HttpServletRequest request) throws IOException {
        requireEmptyBody(request); return projects.archive(projectId);
    }
    static void requireEmptyBody(HttpServletRequest request) throws IOException {
        if (request.getInputStream().read() != -1) throw CoreException.invalid();
    }
}

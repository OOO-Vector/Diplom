package com.teamai.orchestrator.planning.api;

import com.teamai.orchestrator.core.api.PageResponse;
import com.teamai.orchestrator.planning.application.SpecificationService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.io.IOException;
import java.net.URI;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/projects/{projectId}/specifications")
public class SpecificationController {
    private final SpecificationService service;
    public SpecificationController(SpecificationService service) { this.service = service; }
    @PostMapping(consumes = {"text/plain", "application/pdf"}, produces = "application/json")
    public ResponseEntity<SpecificationMetadata> upload(@PathVariable UUID projectId, @RequestParam String title,
            @RequestParam String filename, HttpServletRequest request) throws IOException {
        if (!request.getParameterMap().keySet().equals(java.util.Set.of("title", "filename"))
                || request.getParameterMap().values().stream().anyMatch(values -> values.length != 1))
            throw com.teamai.orchestrator.core.application.CoreException.invalid();
        var result = service.upload(projectId, title, filename, request.getContentType(), request.getContentLengthLong(), request.getInputStream());
        return ResponseEntity.created(URI.create("/api/v1/projects/" + projectId + "/specifications/" + result.id()))
                .cacheControl(CacheControl.noStore()).body(result);
    }
    @GetMapping
    public PageResponse<SpecificationMetadata> list(@PathVariable UUID projectId,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return service.list(projectId, page, size);
    }
    @GetMapping("/{specificationId}")
    public SpecificationMetadata get(@PathVariable UUID projectId, @PathVariable UUID specificationId) {
        return service.get(projectId, specificationId);
    }
    @GetMapping(value = "/{specificationId}/text", produces = "text/plain;charset=UTF-8")
    public ResponseEntity<String> text(@PathVariable UUID projectId, @PathVariable UUID specificationId) {
        return ResponseEntity.ok().contentType(new MediaType("text", "plain", java.nio.charset.StandardCharsets.UTF_8))
                .cacheControl(CacheControl.noStore()).header("X-Content-Type-Options", "nosniff")
                .body(service.text(projectId, specificationId));
    }
}

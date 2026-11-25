package com.teamai.orchestrator.planning.api;

import com.teamai.orchestrator.core.api.PageResponse;
import com.teamai.orchestrator.planning.application.SpecificationService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.io.IOException;
import java.net.URI;
import java.util.UUID;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Part;
import com.teamai.orchestrator.core.application.CoreException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.charset.CodingErrorAction;

@RestController
@RequestMapping("/api/v1/projects/{projectId}/specifications")
public class SpecificationController {
    private final SpecificationService service;
    public SpecificationController(SpecificationService service) { this.service = service; }
    @PostMapping(consumes = "multipart/form-data", produces = "application/json")
    public ResponseEntity<SpecificationMetadata> upload(@PathVariable UUID projectId, HttpServletRequest request)
            throws IOException, ServletException {
        // Inspect physical parts, not merged query/form parameters: duplicates and query substitutes are invalid.
        if (request.getQueryString() != null) throw CoreException.invalid();
        var parts = request.getParts();
        var files = parts.stream().filter(part -> part.getName().equals("file")).toList();
        var titles = parts.stream().filter(part -> part.getName().equals("title")).toList();
        if (parts.size() != 2 || files.size() != 1 || titles.size() != 1) throw CoreException.invalid();
        Part file = files.getFirst(), titlePart = titles.getFirst();
        if (file.getSubmittedFileName() == null || titlePart.getSubmittedFileName() != null || titlePart.getSize() > 800)
            throw CoreException.invalid();
        String title;
        try (var input = titlePart.getInputStream()) {
            byte[] bytes = input.readNBytes(801);
            if (bytes.length > 800) throw CoreException.invalid();
            title = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
        } catch (java.nio.charset.CharacterCodingException exception) { throw CoreException.invalid(); }
        SpecificationMetadata result;
        try (var input = file.getInputStream()) {
            result = service.upload(projectId, title, file.getSubmittedFileName(), file.getContentType(), file.getSize(), input);
        }
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

package com.teamai.orchestrator.core.api;

import com.teamai.orchestrator.core.application.MembershipService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.io.IOException;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/projects/{projectId}")
public class MemberController {
    private final MembershipService memberships;
    public MemberController(MembershipService memberships) { this.memberships = memberships; }
    @GetMapping("/members")
    public PageResponse<MemberResponse> list(@PathVariable UUID projectId, @RequestParam(defaultValue = "0") int page,
                                            @RequestParam(defaultValue = "20") int size) { return memberships.list(projectId, page, size); }
    @PostMapping("/members")
    @ResponseStatus(HttpStatus.CREATED)
    public MemberResponse add(@PathVariable UUID projectId, @Valid @RequestBody AddMemberRequest request) {
        return memberships.add(projectId, request);
    }
    @DeleteMapping("/members/{userId}")
    public ResponseEntity<Void> remove(@PathVariable UUID projectId, @PathVariable UUID userId, HttpServletRequest request) throws IOException {
        ProjectController.requireEmptyBody(request); memberships.remove(projectId, userId);
        return ResponseEntity.noContent().build();
    }
    @PostMapping("/transfer-ownership")
    public ProjectResponse transfer(@PathVariable UUID projectId, @Valid @RequestBody TransferOwnershipRequest request) {
        return memberships.transfer(projectId, request.target());
    }
}

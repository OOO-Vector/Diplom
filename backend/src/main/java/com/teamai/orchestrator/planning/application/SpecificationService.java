package com.teamai.orchestrator.planning.application;

import com.teamai.orchestrator.core.api.PageResponse;
import com.teamai.orchestrator.core.application.*;
import com.teamai.orchestrator.planning.api.SpecificationMetadata;
import com.teamai.orchestrator.planning.persistence.SpecificationRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.*;
import org.springframework.transaction.annotation.*;
import org.springframework.transaction.support.TransactionTemplate;
import java.io.InputStream;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

@Service
public class SpecificationService {
    private final ProjectAccess access;
    private final SpecificationRepository repository;
    private final SpecificationExtractor extractor;
    private final TransactionTemplate writes;
    private final Clock clock;
    public SpecificationService(ProjectAccess access, SpecificationRepository repository, SpecificationExtractor extractor,
                                PlatformTransactionManager manager, Clock clock) {
        this.access = access; this.repository = repository; this.extractor = extractor; this.clock = clock;
        writes = new TransactionTemplate(manager); writes.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    }
    public SpecificationMetadata upload(UUID project, String title, String filename, String type, long length, InputStream input) {
        // Cheap permission check before reading/parsing; recheck under the write lock after extraction.
        writes.executeWithoutResult(tx -> writable(project, false));
        title = title == null ? "" : title.strip();
        validateLabel(title, 200);
        filename = filename == null ? "" : filename.replace('\\', '/');
        filename = filename.substring(filename.lastIndexOf('/') + 1).strip();
        filename = filename.replaceAll("[\\p{Cc}\\p{Cf}<>:\"|?*]", "_");
        validateLabel(filename, 255);
        String text = extractor.extract(input, length, type, filename);
        String storedTitle = title, storedFilename = filename;
        return writes.execute(tx -> {
            UUID actor = writable(project, true);
            long previous = repository.lastVersion(project);
            if (previous == Integer.MAX_VALUE) throw new CoreException(409, "SPECIFICATION_VERSION_LIMIT", "Specification version limit reached");
            var metadata = new SpecificationMetadata(UUID.randomUUID(), project, actor, (int) previous + 1, storedTitle,
                    storedFilename, "uploaded", clock.instant().truncatedTo(ChronoUnit.MICROS));
            repository.insert(metadata, text);
            return metadata;
        }); // Commit completes before 201/Location.
    }
    private UUID writable(UUID project, boolean lock) {
        UUID actor = access.actor();
        var scope = access.member(project, actor, lock);
        if (ProjectAccess.archived(scope.project())) throw CoreException.archived();
        return actor;
    }
    private static void validateLabel(String value, int max) {
        if (value.isEmpty() || value.codePoints().allMatch(cp -> Character.isWhitespace(cp) || Character.isSpaceChar(cp))
                || value.codePointCount(0, value.length()) > max
                || value.codePoints().anyMatch(cp -> Character.isISOControl(cp) || (cp >= 0xD800 && cp <= 0xDFFF))) throw CoreException.invalid();
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PageResponse<SpecificationMetadata> list(UUID project, int page, int size) {
        var paging = ProjectService.page(page, size);
        access.member(project, access.actor(), false);
        return PageResponse.of(repository.list(project, size, paging.getOffset()), page, size, repository.count(project));
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public SpecificationMetadata get(UUID project, UUID id) {
        access.member(project, access.actor(), false);
        return repository.find(project, id).orElseThrow(CoreException::missing);
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public String text(UUID project, UUID id) {
        access.member(project, access.actor(), false);
        return repository.text(project, id).orElseThrow(CoreException::missing);
    }
}

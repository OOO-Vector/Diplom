package com.teamai.orchestrator;

import com.teamai.orchestrator.core.api.CreateProjectRequest;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class ProjectValidationTests {
    @Test void unicodeBoundsMatchPostgresCharactersAndRejectUnstorableText() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            // Supplementary characters occupy two UTF-16 code units but one PostgreSQL/API character.
            assertTrue(validator.validate(new CreateProjectRequest("🔐".repeat(150), "🔐".repeat(4000))).isEmpty());
            for (var invalid : List.of(new CreateProjectRequest("🔐".repeat(151), null),
                    new CreateProjectRequest("Valid", "🔐".repeat(4001)),
                    new CreateProjectRequest("\u0000", null), new CreateProjectRequest("Valid", "\u0000"),
                    new CreateProjectRequest("\uD800", null), new CreateProjectRequest("Valid", "\uD800"))) {
                assertFalse(validator.validate(invalid).isEmpty());
            }
        }
    }
}

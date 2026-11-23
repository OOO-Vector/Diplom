package com.teamai.orchestrator;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.teamai.orchestrator.infrastructure.security.*;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import tools.jackson.databind.json.JsonMapper;
import java.sql.SQLException;
import java.util.Map;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

class ApiProblemLoggingTests {
    @Test void unexpectedAndDatabaseFailuresLogOnlySafeFieldsWithResponseCorrelationId() {
        var logger = (Logger) LoggerFactory.getLogger(ApiProblems.class);
        var appender = new ListAppender<ILoggingEvent>(); appender.start(); logger.addAppender(appender);
        String sensitive = "synthetic-password JWT refresh-cookie private-key request-body";
        try {
            var handler = new ApiExceptionHandler(new ApiProblems(JsonMapper.builder().build()));
            var responses = java.util.List.of(handler.unexpected(new IllegalStateException(sensitive)),
                    handler.conflict(new DataIntegrityViolationException(sensitive, new SQLException(sensitive, "23514"))));
            assertEquals(2, appender.list.size());
            for (int i = 0; i < responses.size(); i++) {
                var response = responses.get(i);
                var body = (Map<?, ?>) response.getBody();
                assertEquals(500, response.getStatusCode().value());
                assertEquals("Unexpected server failure", body.get("detail"));
                UUID.fromString((String) body.get("correlationId"));
                var event = appender.list.get(i);
                assertNull(event.getThrowableProxy());
                assertEquals("ERROR", event.getLevel().toString());
                assertTrue(event.getKeyValuePairs().stream().anyMatch(kv -> kv.key.equals("correlationId") && kv.value.equals(body.get("correlationId"))));
                assertEquals(4, event.getKeyValuePairs().size());
                assertFalse((event.getFormattedMessage() + event.getKeyValuePairs() + body).contains(sensitive));
            }
            assertNotEquals(((Map<?, ?>)responses.get(0).getBody()).get("correlationId"),
                    ((Map<?, ?>)responses.get(1).getBody()).get("correlationId"));
            handler.conflict(new DataIntegrityViolationException(sensitive, new SQLException("ux_users_email_ci", "23505")));
            assertEquals(2, appender.list.size(), "Expected duplicate email is not an unexpected server error");
        } finally { logger.detachAppender(appender); appender.stop(); }
    }
}

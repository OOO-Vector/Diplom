package com.teamai.orchestrator.schema;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Pattern;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.MountableFile;

import static org.junit.jupiter.api.Assertions.assertEquals;

class SqlIntegrityTests {
    private static final Path SCRIPTS = Path.of("../database/tests").toAbsolutePath();
    private static final Path REPORTS = Path.of("build/reports/sql-integrity");
    private static final Pattern PASS_NOTICE = Pattern.compile("NOTICE:\\s+PASS:");
    private static PostgreSQLContainer database;

    @BeforeAll
    static void installSchema() throws Exception {
        database = RefreshSessionSchemaTests.container();
        database.start();
        RefreshSessionSchemaTests.migrate(database, null);
        Files.createDirectories(REPORTS);
    }

    @AfterAll
    static void stopDatabase() {
        if (database != null) database.close();
    }

    @ParameterizedTest(name = "{0} ({1} checks)")
    @CsvSource({
            "001-core-integrity.sql, 6",
            "002-core-ownership-tests.sql, 3",
            "003-planning-integrity-tests.sql, 6",
            "004-project-memory-tests.sql, 7",
            "005-github-integration-tests.sql, 8",
            "006-ai-chat-tests.sql, 10",
            "007-conflict-ml-tests.sql, 17",
            "008-analytics-events-tests.sql, 14",
            "010-task-dependency-cycles-tests.sql, 7"
    })
    void runsIntegrityChecks(String script, int expectedChecks) throws Exception {
        String containerPath = "/tmp/" + script;
        database.copyFileToContainer(MountableFile.forHostPath(SCRIPTS.resolve(script)), containerPath);
        var result = database.execInContainer("env", "LC_ALL=C", "PGCLIENTENCODING=UTF8",
                "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", database.getUsername(),
                "-d", database.getDatabaseName(), "-f", containerPath);

        String report = "%s%nExit code: %d%nSTDOUT%n%s%nSTDERR%n%s".formatted(
                script, result.getExitCode(), result.getStdout(), result.getStderr());
        Files.writeString(REPORTS.resolve(script + ".log"), report);
        System.out.println(report);

        assertEquals(0, result.getExitCode(), report);
        assertEquals(expectedChecks, PASS_NOTICE.matcher(result.getStderr()).results().count(), report);
    }
}

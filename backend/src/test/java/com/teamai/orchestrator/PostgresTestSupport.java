package com.teamai.orchestrator;

import java.nio.file.Path;
import java.util.UUID;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

public abstract class PostgresTestSupport {
    static final String APP_PASSWORD = UUID.randomUUID().toString();
    static final PostgreSQLContainer DATABASE = new PostgreSQLContainer(
            DockerImageName.parse("pgvector/pgvector:pg16").asCompatibleSubstituteFor("postgres"))
            .withDatabaseName("team_ai_db").withUsername("team_ai_admin").withPassword(UUID.randomUUID().toString())
            .withEnv("DB_APP_PASSWORD", APP_PASSWORD)
            .withCopyFileToContainer(MountableFile.forHostPath(
                    Path.of("../database/security/002-init-roles.sh").toAbsolutePath(), 0755),
                    "/docker-entrypoint-initdb.d/002-init-roles.sh");
    static { DATABASE.start(); }

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", () -> "team_ai_app");
        registry.add("spring.datasource.password", () -> APP_PASSWORD);
        registry.add("spring.liquibase.url", DATABASE::getJdbcUrl);
        registry.add("spring.liquibase.user", DATABASE::getUsername);
        registry.add("spring.liquibase.password", DATABASE::getPassword);
        registry.add("app.security.allowed-origins", () -> "https://app.example.test");
    }
}

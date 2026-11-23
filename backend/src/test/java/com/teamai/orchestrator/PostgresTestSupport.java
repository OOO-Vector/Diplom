package com.teamai.orchestrator;

import java.nio.file.Path;
import java.nio.file.Files;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Base64;
import java.util.UUID;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

public abstract class PostgresTestSupport {
    static final KeyPair KEYS;
    static final Path PRIVATE_KEY, PUBLIC_KEY;
    static {
        try {
            var generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(2048); KEYS = generator.generateKeyPair();
            PRIVATE_KEY = pem("PRIVATE KEY", KEYS.getPrivate().getEncoded());
            PUBLIC_KEY = pem("PUBLIC KEY", KEYS.getPublic().getEncoded());
        } catch (Exception exception) { throw new ExceptionInInitializerError(exception); }
    }
    static Path pem(String type, byte[] bytes) throws Exception {
        Path file = Files.createTempFile("team-ai-test-key-", ".pem");
        file.toFile().deleteOnExit();
        Files.writeString(file, "-----BEGIN " + type + "-----\n" + Base64.getMimeEncoder(64, new byte[]{10}).encodeToString(bytes)
                + "\n-----END " + type + "-----\n");
        return file;
    }
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
        registry.add("app.security.jwt.issuer", () -> "https://issuer.example.test");
        registry.add("app.security.jwt.audience", () -> "team-ai-api");
        registry.add("app.security.jwt.key-id", () -> "ephemeral-test");
        registry.add("app.security.jwt.private-key", () -> PRIVATE_KEY.toUri().toString());
        registry.add("app.security.jwt.public-key", () -> PUBLIC_KEY.toUri().toString());
    }
}

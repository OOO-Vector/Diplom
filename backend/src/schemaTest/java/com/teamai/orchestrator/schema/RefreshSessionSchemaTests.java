package com.teamai.orchestrator.schema;

import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.*;
import java.time.Duration;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import liquibase.Contexts;
import liquibase.LabelExpression;
import liquibase.Liquibase;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.ClassLoaderResourceAccessor;
import org.junit.jupiter.api.*;
import org.postgresql.util.PSQLException;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

import static org.junit.jupiter.api.Assertions.*;

/** Applies production Liquibase files, never connects to a configured development database. */
class RefreshSessionSchemaTests {
    static final String MASTER = "db/changelog/db.changelog-master.yaml";
    static final String APP_PASSWORD = UUID.randomUUID().toString();
    static final String START = "2026-11-23 00:00:00+00";
    static final String END = "2026-11-30 00:00:00+00";
    static PostgreSQLContainer clean;
    static PostgreSQLContainer upgraded;
    static String oldHistory;
    static String sentinel;

    static PostgreSQLContainer container() {
        return new PostgreSQLContainer(DockerImageName.parse("pgvector/pgvector:pg16")
                .asCompatibleSubstituteFor("postgres"))
                .withDatabaseName("team_ai_db").withUsername("team_ai_admin")
                .withPassword(UUID.randomUUID().toString())
                .withEnv("DB_APP_PASSWORD", APP_PASSWORD)
                .withCopyFileToContainer(MountableFile.forHostPath(
                        Path.of("../database/security/002-init-roles.sh").toAbsolutePath(), 0755),
                        "/docker-entrypoint-initdb.d/002-init-roles.sh")
                .withStartupTimeout(Duration.ofMinutes(2));
    }

    @BeforeAll static void install() throws Exception {
        clean = container();
        upgraded = container();
        clean.start();
        migrate(clean, null);
        upgraded.start();
        migrate(upgraded, 12);
        try (var c = admin(upgraded)) {
            assertEquals("12", scalar(c, "SELECT count(*) FROM databasechangelog"));
            assertEquals("27", scalar(c, tableCount()));
            oldHistory = history(c);
            c.setAutoCommit(false);
            String user = createUser(c);
            String project = UUID.randomUUID().toString();
            sql(c, "INSERT INTO projects VALUES ('" + project + "','upgrade sentinel',NULL,'" + user
                    + "','active','" + START + "','" + START + "')");
            sql(c, "INSERT INTO project_members VALUES ('" + project + "','" + user + "','owner','" + START + "')");
            c.commit();
            sentinel = scalar(c, "SELECT row_to_json(p)::text FROM projects p WHERE name='upgrade sentinel'");
        }
        migrate(upgraded, null);
        // A second update must be a no-op, without checksum recalculation/clearCheckSums.
        migrate(upgraded, null);
        for (var db : List.of(clean, upgraded)) {
            try (var c = admin(db)) {
                System.out.println("CORE-01 environment: PostgreSQL=" + scalar(c, "SHOW server_version")
                        + ", pgvector=" + scalar(c, "SELECT extversion FROM pg_extension WHERE extname='vector'")
                        + ", tables=" + scalar(c, tableCount()) + ", changesets="
                        + scalar(c, "SELECT count(*) FROM databasechangelog"));
                System.out.println("Image ID=" + db.getContainerInfo().getImageId());
            }
        }
    }

    @AfterAll static void stopOnlyOwnedContainers() {
        if (upgraded != null) upgraded.close();
        if (clean != null) clean.close();
    }

    static Connection admin(PostgreSQLContainer db) throws SQLException {
        return DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
    }
    static Connection app() throws SQLException {
        return DriverManager.getConnection(upgraded.getJdbcUrl(), "team_ai_app", APP_PASSWORD);
    }
    static void migrate(PostgreSQLContainer db, Integer count) throws Exception {
        try (var c = admin(db);
             var resources = new ClassLoaderResourceAccessor();
             var lb = new Liquibase(MASTER, resources,
                     DatabaseFactory.getInstance().findCorrectDatabaseImplementation(new JdbcConnection(c)))) {
            lb.validate();
            if (count == null) lb.update(new Contexts(), new LabelExpression());
            else lb.update(count, new Contexts(), new LabelExpression());
        }
    }
    static void sql(Connection c, String sql) throws SQLException {
        try (var statement = c.createStatement()) { statement.execute(sql); }
    }
    static String scalar(Connection c, String sql) throws SQLException {
        try (var statement = c.createStatement(); var result = statement.executeQuery(sql)) {
            assertTrue(result.next());
            return result.getString(1);
        }
    }
    static String tableCount() {
        return "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('databasechangelog','databasechangeloglock')";
    }
    static String history(Connection c) throws SQLException {
        return scalar(c, "SELECT string_agg(id||':'||author||':'||filename||':'||md5sum||':'||orderexecuted||':'||exectype, E'\\n' ORDER BY orderexecuted) FROM databasechangelog WHERE orderexecuted<=12");
    }
    static String createUser(Connection c) throws SQLException {
        String id = UUID.randomUUID().toString();
        sql(c, "INSERT INTO users VALUES ('" + id + "','" + id + "@example.test','synthetic-hash-fixture','Schema fixture',true,'" + START + "','" + START + "')");
        return id;
    }
    static String family(Connection c, String user) throws SQLException {
        String id = UUID.randomUUID().toString();
        sql(c, "INSERT INTO refresh_token_families(id,user_id,issued_at,expires_at) VALUES ('"
                + id + "','" + user + "','" + START + "','" + END + "')");
        return id;
    }
    static String insertSession(String id, String family, String hash) {
        return "INSERT INTO refresh_sessions(id,family_id,family_issued_at,expires_at,token_hash,issued_at) VALUES ('"
                + id + "','" + family + "','" + START + "','" + END + "'," + hash + ",'" + START + "')";
    }
    static String hash() {
        byte[] syntheticToken = new byte[32];
        new SecureRandom().nextBytes(syntheticToken);
        try {
            return "decode('" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(syntheticToken)) + "','hex')";
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
    static String session(Connection c, String family) throws SQLException {
        String id = UUID.randomUUID().toString();
        sql(c, insertSession(id, family, hash()));
        return id;
    }
    // Roll back to a savepoint so a negative SQL case cannot poison subsequent assertions.
    static void rejected(Connection c, String state, String constraint, String command) throws SQLException {
        Savepoint savepoint = c.setSavepoint();
        try {
            var error = assertThrows(SQLException.class, () -> sql(c, command), command);
            assertEquals(state, error.getSQLState(), command);
            if (constraint != null) assertEquals(constraint, ((PSQLException) error).getServerErrorMessage().getConstraint());
        } finally { c.rollback(savepoint); }
    }

    @Test void cleanInstallHasThirteenChangesetsAndPgvector() throws Exception {
        try (var c = admin(clean)) {
            assertTrue(scalar(c, "SHOW server_version").startsWith("16."));
            assertNotNull(scalar(c, "SELECT extversion FROM pg_extension WHERE extname='vector'"));
            assertEquals("29", scalar(c, tableCount()));
            assertEquals("13", scalar(c, "SELECT count(*) FROM databasechangelog WHERE exectype='EXECUTED'"));
            assertEquals("013-create-refresh-sessions", scalar(c, "SELECT id FROM databasechangelog WHERE orderexecuted=13"));
            assertEquals("0", scalar(c, "SELECT count(*) FROM pg_index WHERE NOT indisvalid"));
        }
    }

    @Test void upgradePreservesDataChecksumsAndOriginalHistory() throws Exception {
        try (var c = admin(upgraded)) {
            assertEquals(oldHistory, history(c));
            assertEquals("13", scalar(c, "SELECT count(*) FROM databasechangelog"));
            assertEquals("29", scalar(c, tableCount()));
            assertEquals(sentinel, scalar(c, "SELECT row_to_json(p)::text FROM projects p WHERE name='upgrade sentinel'"));
            assertEquals("1", scalar(c, "SELECT count(*) FROM project_members WHERE role='owner'"));
            try (var cleanConnection = admin(clean)) { assertEquals(history(cleanConnection), history(c)); }
        }
    }

    @Test void digestLengthUniquenessAndOwnerForeignKey() throws Exception {
        try (var c = admin(upgraded)) {
            c.setAutoCommit(false);
            String user = createUser(c), f = family(c, user), other = family(c, user);
            String digest = hash();
            sql(c, insertSession(UUID.randomUUID().toString(), f, digest));
            rejected(c, "23505", "uq_refresh_session_hash", insertSession(UUID.randomUUID().toString(), other, digest));
            for (int bytes : List.of(0, 31, 33, 64)) {
                rejected(c, "23514", "ck_refresh_session_hash", insertSession(UUID.randomUUID().toString(), other,
                        "decode(repeat('ab'," + bytes + "),'hex')"));
            }
            rejected(c, "23502", null, insertSession(UUID.randomUUID().toString(), other, "NULL"));
            rejected(c, "23503", "fk_refresh_family_user", "INSERT INTO refresh_token_families VALUES ('"
                    + UUID.randomUUID() + "','" + UUID.randomUUID() + "','" + START + "','" + END + "',NULL)");
            rejected(c, "23503", "fk_refresh_session_family", insertSession(UUID.randomUUID().toString(), UUID.randomUUID().toString(), hash()));
            assertEquals("bytea", scalar(c, "SELECT data_type FROM information_schema.columns WHERE table_name='refresh_sessions' AND column_name='token_hash'"));
            assertEquals("0", scalar(c, "SELECT count(*) FROM information_schema.columns WHERE table_name IN ('refresh_sessions','refresh_token_families') AND column_name IN ('token','raw_token','refresh_token')"));
            c.rollback();
        }
    }

    @Test void lifetimeCannotSlideAndInvalidTimestampsAreRejected() throws Exception {
        try (var c = admin(upgraded)) {
            c.setAutoCommit(false);
            String f = family(c, createUser(c)), id = session(c, f);
            rejected(c, "23514", "ck_refresh_family_lifetime", "UPDATE refresh_token_families SET expires_at=expires_at+interval '1 second' WHERE id='" + f + "'");
            rejected(c, "23514", "ck_refresh_family_lifetime", "UPDATE refresh_token_families SET issued_at='-infinity',expires_at='infinity' WHERE id='" + f + "'");
            rejected(c, "23503", "fk_refresh_session_family", "UPDATE refresh_sessions SET expires_at=expires_at+interval '1 second' WHERE id='" + id + "'");
            for (String time : List.of("2026-11-22 23:59:59+00", END, "infinity")) {
                rejected(c, "23514", "ck_refresh_session_issued", "UPDATE refresh_sessions SET issued_at='" + time + "' WHERE id='" + id + "'");
            }
            rejected(c, "23514", "ck_refresh_session_revoked", "UPDATE refresh_sessions SET revoked_at=issued_at-interval '1 second' WHERE id='" + id + "'");
            rejected(c, "23514", "ck_refresh_family_revoked", "UPDATE refresh_token_families SET revoked_at='infinity' WHERE id='" + f + "'");
            // Absolute 168-hour interval remains exact across a DST transition.
            sql(c, "SET LOCAL TIME ZONE 'America/New_York'");
            sql(c, "INSERT INTO refresh_token_families VALUES ('" + UUID.randomUUID() + "','"
                    + scalar(c, "SELECT user_id FROM refresh_token_families WHERE id='" + f + "'")
                    + "','2026-03-07 12:00:00-05','2026-03-14 13:00:00-04',NULL)");
            c.rollback();
        }
    }

    @Test void replacementMustExistInSameFamilyAndConsumptionIsPaired() throws Exception {
        try (var c = admin(upgraded)) {
            c.setAutoCommit(false);
            String user = createUser(c), f = family(c, user), id = session(c, f);
            String other = session(c, family(c, user));
            rejected(c, "23514", "ck_refresh_session_replacement_state", "UPDATE refresh_sessions SET consumed_at=issued_at WHERE id='" + id + "'");
            rejected(c, "23514", "ck_refresh_session_not_self", "UPDATE refresh_sessions SET consumed_at=issued_at,replacement_id=id WHERE id='" + id + "'");
            rejected(c, "23505", "ux_refresh_session_available_per_family", insertSession(UUID.randomUUID().toString(), f, hash()));
            for (String replacement : List.of(other, UUID.randomUUID().toString())) {
                rejected(c, "23503", "fk_refresh_session_replacement", "UPDATE refresh_sessions SET consumed_at=issued_at,replacement_id='"
                        + replacement + "' WHERE id='" + id + "'; SET CONSTRAINTS fk_refresh_session_replacement IMMEDIATE");
            }
            String next = UUID.randomUUID().toString();
            // The deferred FK supports consume-then-insert inside one transaction.
            sql(c, "UPDATE refresh_sessions SET consumed_at=issued_at,replacement_id='" + next + "' WHERE id='" + id + "'");
            sql(c, insertSession(next, f, hash()));
            sql(c, "SET CONSTRAINTS ALL IMMEDIATE");
            assertEquals(next, scalar(c, "SELECT replacement_id FROM refresh_sessions WHERE id='" + id + "'"));
            rejected(c, "23505", "uq_refresh_session_replacement", "INSERT INTO refresh_sessions "
                    + "(id,family_id,family_issued_at,expires_at,token_hash,issued_at,consumed_at,replacement_id) SELECT '"
                    + UUID.randomUUID() + "',family_id,family_issued_at,expires_at," + hash()
                    + ",issued_at,consumed_at,replacement_id FROM refresh_sessions WHERE id='" + id + "'");
            for (String value : List.of("expires_at", "issued_at-interval '1 second'", "'infinity'::timestamptz")) {
                rejected(c, "23514", "ck_refresh_session_consumed", "UPDATE refresh_sessions SET consumed_at=" + value + " WHERE id='" + id + "'");
            }
            // Revoking a consumed token preserves its replacement/history.
            sql(c, "UPDATE refresh_sessions SET revoked_at=expires_at+interval '1 hour' WHERE id='" + id + "'");
            c.rollback();
        }
    }

    @Test void missingReplacementFailsAtCommitAndRollsBack() throws Exception {
        try (var c = admin(upgraded)) {
            c.setAutoCommit(false);
            String f = family(c, createUser(c)), id = session(c, f);
            c.commit();
            sql(c, "UPDATE refresh_sessions SET consumed_at=issued_at,replacement_id='" + UUID.randomUUID() + "' WHERE id='" + id + "'");
            var error = assertThrows(SQLException.class, c::commit);
            assertEquals("23503", error.getSQLState());
            c.rollback();
            assertEquals("true", scalar(c, "SELECT (consumed_at IS NULL AND replacement_id IS NULL)::text FROM refresh_sessions WHERE id='" + id + "'"));
        }
    }

    @Test void applicationCanUseSchemaButCannotRewriteIdentityOrDestroyHistory() throws Exception {
        String user;
        try (var c = admin(upgraded)) { user = createUser(c); }
        try (var c = app()) {
            c.setAutoCommit(false);
            String f = family(c, user), id = session(c, f), next = UUID.randomUUID().toString();
            assertEquals(f, scalar(c, "SELECT id FROM refresh_token_families WHERE id='" + f + "' FOR UPDATE"));
            sql(c, "UPDATE refresh_sessions SET consumed_at=issued_at,replacement_id='" + next + "' WHERE id='" + id + "'");
            sql(c, insertSession(next, f, hash()));
            sql(c, "SET CONSTRAINTS ALL IMMEDIATE");
            sql(c, "UPDATE refresh_token_families SET revoked_at=issued_at WHERE id='" + f + "'");
            sql(c, "UPDATE refresh_sessions SET revoked_at=issued_at WHERE family_id='" + f + "'");
            for (String command : List.of(
                    "DELETE FROM refresh_sessions WHERE id='" + id + "'",
                    "DELETE FROM refresh_token_families WHERE id='" + f + "'",
                    "TRUNCATE refresh_sessions",
                    "ALTER TABLE refresh_sessions ADD COLUMN forbidden integer",
                    "CREATE TABLE public.forbidden(id integer)",
                    "SELECT * FROM databasechangelog",
                    "UPDATE refresh_sessions SET token_hash=" + hash() + " WHERE id='" + id + "'",
                    "UPDATE refresh_sessions SET family_id=family_id WHERE id='" + id + "'",
                    "UPDATE refresh_token_families SET expires_at=expires_at WHERE id='" + f + "'",
                    "UPDATE refresh_token_families SET user_id=user_id WHERE id='" + f + "'")) {
                rejected(c, "42501", null, command);
            }
            c.rollback();
        }
        try (var c = admin(upgraded)) {
            c.setAutoCommit(false);
            sql(c, "SET LOCAL ROLE app_read");
            rejected(c, "42501", null, "SELECT * FROM refresh_sessions");
            rejected(c, "42501", null, "SELECT * FROM refresh_token_families");
            c.rollback();
        }
    }

    @Test void familyRowLockSerializesGenerationsAndSeesCommittedRevocation() throws Exception {
        String f, other, oldToken, newToken;
        try (var c = admin(upgraded)) {
            c.setAutoCommit(false);
            String user = createUser(c);
            f = family(c, user); other = family(c, user);
            oldToken = session(c, f);
            newToken = UUID.randomUUID().toString();
            sql(c, "UPDATE refresh_sessions SET consumed_at=issued_at,replacement_id='" + newToken + "' WHERE id='" + oldToken + "'");
            sql(c, insertSession(newToken, f, hash()));
            c.commit();
        }
        try (var a = app(); var b = app(); var observer = admin(upgraded);
             var executor = Executors.newSingleThreadExecutor()) {
            a.setAutoCommit(false); b.setAutoCommit(false);
            assertEquals(Connection.TRANSACTION_READ_COMMITTED, b.getTransactionIsolation());
            assertEquals(f, scalar(a, "SELECT f.id FROM refresh_token_families f JOIN refresh_sessions s ON s.family_id=f.id WHERE s.id='"
                    + oldToken + "' FOR UPDATE OF f"));
            // Another login family is independently writable.
            scalar(b, "SELECT id FROM refresh_token_families WHERE id='" + other + "' FOR UPDATE NOWAIT");
            b.commit();
            int backend = Integer.parseInt(scalar(b, "SELECT pg_backend_pid()"));
            var waiting = executor.submit(() -> scalar(b,
                    "SELECT (f.revoked_at IS NOT NULL)::text FROM refresh_token_families f JOIN refresh_sessions s ON s.family_id=f.id WHERE s.id='"
                            + newToken + "' FOR UPDATE OF f"));
            try {
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
                boolean blocked = false;
                while (System.nanoTime() < deadline) {
                    if ("true".equals(scalar(observer, "SELECT (cardinality(pg_blocking_pids(" + backend + "))>0)::text"))) {
                        blocked = true; break;
                    }
                    Thread.sleep(20);
                }
                assertTrue(blocked, "Second family-lock request must actually block in PostgreSQL");
                sql(a, "UPDATE refresh_token_families SET revoked_at=issued_at WHERE id='" + f + "'");
                a.commit();
                assertEquals("true", waiting.get(5, TimeUnit.SECONDS));
                b.commit();
            } finally {
                a.rollback(); // release blocker even if an assertion fails
                if (!waiting.isDone()) waiting.get(5, TimeUnit.SECONDS);
                b.rollback();
            }
        }
    }
}

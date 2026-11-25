package com.teamai.orchestrator.core.persistence;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import java.util.Optional;

@Repository
public class RefreshSessionStore {
    private final JdbcTemplate jdbc;
    public RefreshSessionStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    /** Initial issuance only. Joins the login transaction; never updates or rotates existing generations. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void insert(UUID userId, byte[] digest, Instant issued, Instant expires) {
        UUID family = UUID.randomUUID();
        jdbc.update("insert into refresh_token_families(id, user_id, issued_at, expires_at) values (?, ?, ?, ?)",
                family, userId, Timestamp.from(issued), Timestamp.from(expires));
        jdbc.update("""
                insert into refresh_sessions(id, family_id, family_issued_at, expires_at, token_hash, issued_at)
                values (?, ?, ?, ?, ?, ?)
                """, UUID.randomUUID(), family, Timestamp.from(issued), Timestamp.from(expires), digest, Timestamp.from(issued));
    }

    public record Family(UUID id, UUID userId, Instant issuedAt, Instant expiresAt, Instant revokedAt) {}
    public record Generation(UUID id, Instant issuedAt, Instant consumedAt, Instant revokedAt) {}

    /** Lock only the stable family. Generation state must be read in a new statement after this returns. */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<Family> lockFamily(byte[] digest) {
        return jdbc.query("""
                select f.* from refresh_token_families f
                join refresh_sessions s on s.family_id = f.id where s.token_hash = ? for update of f
                """, (rs, row) -> new Family(rs.getObject("id", UUID.class), rs.getObject("user_id", UUID.class),
                rs.getTimestamp("issued_at").toInstant(), rs.getTimestamp("expires_at").toInstant(),
                instant(rs.getTimestamp("revoked_at"))), digest).stream().findFirst();
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public Generation generation(UUID family, byte[] digest) {
        return jdbc.queryForObject("select id, issued_at, consumed_at, revoked_at from refresh_sessions where family_id = ? and token_hash = ?",
                (rs, row) -> new Generation(rs.getObject("id", UUID.class), rs.getTimestamp("issued_at").toInstant(),
                        instant(rs.getTimestamp("consumed_at")), instant(rs.getTimestamp("revoked_at"))), family, digest);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void revoke(Family family, Instant now) {
        // Preserve the first revocation and tolerate backwards clock adjustment without clearing history.
        jdbc.update("update refresh_token_families set revoked_at = ? where id = ? and revoked_at is null",
                Timestamp.from(now.isBefore(family.issuedAt()) ? family.issuedAt() : now), family.id());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void rotate(Family family, Generation previous, byte[] digest, Instant now) {
        UUID replacement = UUID.randomUUID();
        int updated = jdbc.update("""
                update refresh_sessions set consumed_at = ?, replacement_id = ?
                where id = ? and family_id = ? and consumed_at is null and revoked_at is null
                """, Timestamp.from(now), replacement, previous.id(), family.id());
        if (updated != 1) throw new IllegalStateException("Refresh generation state changed under family lock");
        jdbc.update("""
                insert into refresh_sessions(id, family_id, family_issued_at, expires_at, token_hash, issued_at)
                values (?, ?, ?, ?, ?, ?)
                """, replacement, family.id(), Timestamp.from(family.issuedAt()), Timestamp.from(family.expiresAt()), digest, Timestamp.from(now));
    }

    private static Instant instant(Timestamp timestamp) { return timestamp == null ? null : timestamp.toInstant(); }
}

package com.teamai.orchestrator.core.persistence;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

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
}

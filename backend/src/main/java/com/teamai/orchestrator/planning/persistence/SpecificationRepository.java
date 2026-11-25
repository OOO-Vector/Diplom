package com.teamai.orchestrator.planning.persistence;

import com.teamai.orchestrator.planning.api.SpecificationMetadata;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import java.sql.Timestamp;
import java.util.*;

/** Append-only application API. Existing DB grants are broader; no update/delete is exposed. */
@Repository
public class SpecificationRepository {
    private static final String COLUMNS = "id, project_id, uploaded_by, version, title, original_filename, status, created_at";
    private static final RowMapper<SpecificationMetadata> METADATA = (row, number) -> new SpecificationMetadata(
            row.getObject("id", UUID.class), row.getObject("project_id", UUID.class), row.getObject("uploaded_by", UUID.class),
            row.getInt("version"), row.getString("title"), row.getString("original_filename"), row.getString("status"),
            row.getTimestamp("created_at").toInstant());
    private final JdbcTemplate jdbc;
    public SpecificationRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public long lastVersion(UUID project) {
        return jdbc.queryForObject("select coalesce(max(version),0)::bigint from specifications where project_id=?", Long.class, project);
    }
    public void insert(SpecificationMetadata value, String text) {
        jdbc.update("insert into specifications (" + COLUMNS + ", content) values (?,?,?,?,?,?,?,?,?)",
                value.id(), value.projectId(), value.uploadedBy(), value.version(), value.title(), value.originalFilename(),
                value.status(), Timestamp.from(value.createdAt()), text);
    }
    public long count(UUID project) {
        return jdbc.queryForObject("select count(*) from specifications where project_id=?", Long.class, project);
    }
    public List<SpecificationMetadata> list(UUID project, int size, long offset) {
        return jdbc.query("select " + COLUMNS + " from specifications where project_id=? order by version desc limit ? offset ?",
                METADATA, project, size, offset);
    }
    public Optional<SpecificationMetadata> find(UUID project, UUID id) {
        return jdbc.query("select " + COLUMNS + " from specifications where project_id=? and id=?", METADATA, project, id).stream().findFirst();
    }
    public Optional<String> text(UUID project, UUID id) {
        return jdbc.query("select content from specifications where project_id=? and id=?",
                (row, number) -> row.getString(1), project, id).stream().findFirst();
    }
}

package com.teamai.orchestrator.core.persistence;

import com.teamai.orchestrator.core.domain.Project;
import com.teamai.orchestrator.core.api.ProjectResponse;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import java.util.*;

public interface ProjectRepository extends JpaRepository<Project, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Project p where p.id = :id")
    Optional<Project> lock(@Param("id") UUID id);

    @Query("""
            select new com.teamai.orchestrator.core.api.ProjectResponse(p.id, p.name, p.description, p.createdBy,
                p.status, m.role, p.createdAt, p.updatedAt)
            from Project p join ProjectMember m on m.id.projectId = p.id
            where m.id.userId = :actor and (:status is null or p.status = :status)
            order by p.createdAt desc, p.id desc
            """)
    List<ProjectResponse> visible(@Param("actor") UUID actor, @Param("status") String status, Pageable page);
    @Query("""
            select count(p) from Project p join ProjectMember m on m.id.projectId = p.id
            where m.id.userId = :actor and (:status is null or p.status = :status)
            """)
    long countVisible(@Param("actor") UUID actor, @Param("status") String status);
}

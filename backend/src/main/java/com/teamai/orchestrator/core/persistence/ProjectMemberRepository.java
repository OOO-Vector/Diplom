package com.teamai.orchestrator.core.persistence;

import com.teamai.orchestrator.core.domain.ProjectMember;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.data.domain.Pageable;
import com.teamai.orchestrator.core.api.MemberResponse;
import java.util.*;

public interface ProjectMemberRepository extends JpaRepository<ProjectMember, ProjectMember.Id> {
    @Query("""
            select new com.teamai.orchestrator.core.api.MemberResponse(m.id.userId, u.displayName, m.role, m.joinedAt)
            from ProjectMember m join User u on u.id = m.id.userId where m.id.projectId = :project
            order by m.joinedAt asc, m.id.userId asc
            """)
    List<MemberResponse> page(@Param("project") UUID project, Pageable page);
    @Query("select count(m) from ProjectMember m where m.id.projectId = :project")
    long countInProject(@Param("project") UUID project);
}

package com.teamai.orchestrator.core.persistence;

import com.teamai.orchestrator.core.domain.ProjectMember;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProjectMemberRepository extends JpaRepository<ProjectMember, ProjectMember.Id> {}

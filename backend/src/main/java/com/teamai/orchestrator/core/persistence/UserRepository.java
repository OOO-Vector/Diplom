package com.teamai.orchestrator.core.persistence;

import com.teamai.orchestrator.core.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {
    // Use PostgreSQL lower(), exactly as the existing unique index does.
    @Query(value = "select * from users where lower(email) = lower(:email)", nativeQuery = true)
    Optional<User> findByEmail(@Param("email") String email);
}

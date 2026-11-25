package com.teamai.orchestrator;

import com.teamai.orchestrator.core.domain.*;
import com.teamai.orchestrator.core.persistence.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

abstract class ProjectApiTestSupport extends AuthApiTestSupport {
    @Autowired UserRepository users;
    @Autowired ProjectRepository projects;
    @Autowired ProjectMemberRepository members;
    User actor() {
        return users.saveAndFlush(new User(UUID.randomUUID()+"@example.test", "Test user", passwords.encode(PASSWORD), Instant.now()));
    }
    MockHttpServletRequestBuilder as(User actor, MockHttpServletRequestBuilder request) {
        return request.header("Authorization", "Bearer " + tokens.issue(actor.getId()));
    }
    MockHttpServletRequestBuilder body(MockHttpServletRequestBuilder request, Object body) {
        return request.contentType("application/json").content(json.writeValueAsString(body));
    }
    UUID create(User actor) throws Exception {
        var response = mvc.perform(as(actor, body(post("/api/v1/projects"), Map.of("name", "Project", "description", "Original"))))
                .andReturn().getResponse();
        assertEquals(201, response.getStatus(), response.getContentAsString());
        return UUID.fromString(json.readTree(response.getContentAsString()).get("id").asString());
    }
    void fixtureMember(UUID project, User user) { members.saveAndFlush(new ProjectMember(project, user.getId(), "member", Instant.now())); }
    void oneOwner(UUID project) {
        assertEquals(1, jdbc.queryForObject("select count(*) from project_members where project_id=? and role='owner'", Integer.class, project));
    }
}

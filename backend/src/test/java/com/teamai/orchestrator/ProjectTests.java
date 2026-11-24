package com.teamai.orchestrator;

import com.teamai.orchestrator.core.domain.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

class ProjectTests extends ProjectApiTestSupport {
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    com.teamai.orchestrator.core.application.ProjectService service;

    @Test void deferredOwnerConstraintRollsBackWholeCreation() throws Exception {
        var actor = actor(); long before = projects.count(); long memberships = members.count();
        com.teamai.orchestrator.core.application.ProjectService target = org.springframework.test.util.AopTestUtils.getUltimateTargetObject(service);
        org.mockito.Mockito.doAnswer(invocation -> {
            var created = (com.teamai.orchestrator.core.api.ProjectResponse)invocation.callRealMethod();
            jdbc.update("delete from project_members where project_id=?", created.id()); // Deferred trigger fails at COMMIT.
            return created;
        }).when(target).create(org.mockito.ArgumentMatchers.any());
        var response = mvc.perform(as(actor, body(post("/api/v1/projects"), Map.of("name", "Rollback")))).andReturn().getResponse();
        assertEquals(500, response.getStatus()); assertNull(response.getHeader("Location"));
        assertEquals(before, projects.count()); assertEquals(memberships, members.count());
    }
    @Test void createsSoleOwnerAtomicallyWithLocationAndSafeResponse() throws Exception {
        var actor = actor();
        var response = mvc.perform(as(actor, body(post("/api/v1/projects"), Map.of("name", " Example ")))).andReturn().getResponse();
        assertEquals(201, response.getStatus()); var dto = json.readTree(response.getContentAsString());
        UUID id = UUID.fromString(dto.get("id").asString());
        assertEquals("/api/v1/projects/"+id, response.getHeader("Location")); assertEquals(8, dto.size());
        assertEquals("Example", dto.get("name").asString()); assertTrue(dto.get("description").isNull());
        assertEquals(actor.getId().toString(), dto.get("createdBy").asString()); assertEquals("owner", dto.get("myRole").asString());
        oneOwner(id); assertEquals("team_ai_app", jdbc.queryForObject("select current_user", String.class));
    }
    @Test void listingIsScopedPaginatedSortedAndFilterable() throws Exception {
        var owner = actor(); var reader = actor(); var foreign = actor();
        var first = create(owner); var second = create(owner); create(foreign); fixtureMember(first, reader);
        jdbc.update("update projects set created_at='2026-01-01T00:00:00Z', updated_at='2026-01-01T00:00:00Z' where id in (?,?)", first, second);
        var expected = jdbc.queryForList("select id from projects where created_by=? order by created_at desc,id desc", UUID.class, owner.getId());
        var page = json.readTree(mvc.perform(as(owner, get("/api/v1/projects").param("size", "1"))).andReturn().getResponse().getContentAsString());
        assertEquals(2, page.get("totalElements").asInt()); assertEquals(2, page.get("totalPages").asInt());
        assertEquals(expected.getFirst().toString(), page.get("items").get(0).get("id").asString());
        var next = json.readTree(mvc.perform(as(owner, get("/api/v1/projects").param("size", "1").param("page", "1"))).andReturn().getResponse().getContentAsString());
        assertEquals(expected.get(1).toString(), next.get("items").get(0).get("id").asString());
        var visible = json.readTree(mvc.perform(as(reader, get("/api/v1/projects"))).andReturn().getResponse().getContentAsString());
        assertEquals(1, visible.get("totalElements").asInt()); assertEquals(20, visible.get("size").asInt());
        assertEquals("member", visible.get("items").get(0).get("myRole").asString());
        assertEquals(200, mvc.perform(as(owner, post("/api/v1/projects/"+first+"/archive"))).andReturn().getResponse().getStatus());
        var archived = json.readTree(mvc.perform(as(owner, get("/api/v1/projects").param("status", "archived"))).andReturn().getResponse().getContentAsString());
        assertEquals(1, archived.get("totalElements").asInt());
        var far = json.readTree(mvc.perform(as(owner, get("/api/v1/projects").param("page", "2147483647"))).andReturn().getResponse().getContentAsString());
        assertEquals(0, far.get("items").size()); assertEquals(2, far.get("totalElements").asInt());
    }
    @Test void scopedReadsAndOwnerWritesRespectArchiveAndPatchPresence() throws Exception {
        var owner = actor(); var reader = actor(); var foreign = actor(); var id = create(owner); fixtureMember(id, reader);
        String path = "/api/v1/projects/" + id;
        assertEquals(200, mvc.perform(as(reader, get(path))).andReturn().getResponse().getStatus());
        for (UUID target : List.of(id, UUID.randomUUID())) {
            var response = mvc.perform(as(foreign, get("/api/v1/projects/"+target))).andReturn().getResponse();
            assertEquals(404, response.getStatus()); assertEquals("PROJECT_NOT_FOUND", json.readTree(response.getContentAsString()).get("code").asString());
            assertEquals(404, mvc.perform(as(foreign, body(patch("/api/v1/projects/"+target), Map.of("name", "Denied")))).andReturn().getResponse().getStatus());
            assertEquals(404, mvc.perform(as(foreign, post("/api/v1/projects/"+target+"/archive"))).andReturn().getResponse().getStatus());
        }
        assertEquals(403, mvc.perform(as(reader, body(patch(path), Map.of("name", "Denied")))).andReturn().getResponse().getStatus());
        assertEquals(403, mvc.perform(as(reader, post(path+"/archive"))).andReturn().getResponse().getStatus());
        var changed = mvc.perform(as(owner, body(patch(path), Map.of("name", " Renamed ")))).andReturn().getResponse();
        assertEquals(200, changed.getStatus()); assertEquals("Original", json.readTree(changed.getContentAsString()).get("description").asString());
        var cleared = mvc.perform(as(owner, patch(path).contentType("application/json").content("{\"description\":null}"))).andReturn().getResponse();
        assertEquals(200, cleared.getStatus()); assertTrue(json.readTree(cleared.getContentAsString()).get("description").isNull());
        var archived = mvc.perform(as(owner, post(path+"/archive"))).andReturn().getResponse(); assertEquals(200, archived.getStatus());
        assertEquals(archived.getContentAsString(), mvc.perform(as(owner, post(path+"/archive"))).andReturn().getResponse().getContentAsString());
        assertEquals(200, mvc.perform(as(reader, get(path))).andReturn().getResponse().getStatus());
        assertEquals(409, mvc.perform(as(owner, body(patch(path), Map.of("name", "Denied")))).andReturn().getResponse().getStatus());
        oneOwner(id);
    }
    @Test void validationAndAuthenticationRejectUnsafeRequests() throws Exception {
        var actor = actor(); var id = create(actor); String path = "/api/v1/projects/"+id;
        assertEquals(400, mvc.perform(as(actor, body(post("/api/v1/projects"), Map.of("name", "Injected", "createdBy", UUID.randomUUID())))).andReturn().getResponse().getStatus());
        assertEquals(400, mvc.perform(as(actor, body(post("/api/v1/projects"), Map.of("name", "Injected", "role", "owner")))).andReturn().getResponse().getStatus());
        for (String input : List.of("{}", "{\"name\":null}", "{\"name\":\"   \"}", "{\"status\":\"archived\"}", "{\"createdBy\":\""+actor.getId()+"\"}", "{\"namePresent\":true}", "{\"name\":123}")) {
            assertEquals(400, mvc.perform(as(actor, patch(path).contentType("application/json").content(input))).andReturn().getResponse().getStatus(), input);
        }
        for (String name : List.of("", " ", "x".repeat(151))) assertEquals(400, mvc.perform(as(actor, body(post("/api/v1/projects"), Map.of("name", name)))).andReturn().getResponse().getStatus());
        assertEquals(400, mvc.perform(as(actor, body(patch(path), Map.of("description", "x".repeat(4001))))).andReturn().getResponse().getStatus());
        assertEquals(400, mvc.perform(as(actor, get("/api/v1/projects/1-1-1-1-1"))).andReturn().getResponse().getStatus());
        for (String query : List.of("page=-1", "size=0", "size=101", "page=no", "status=bad"))
            assertEquals(400, mvc.perform(as(actor, get("/api/v1/projects?"+query))).andReturn().getResponse().getStatus());
        assertEquals(400, mvc.perform(as(actor, body(post(path+"/archive"), Map.of()))).andReturn().getResponse().getStatus());
        assertEquals(413, mvc.perform(as(actor, post("/api/v1/projects").contentType("application/json").content(" ".repeat(32769)))).andReturn().getResponse().getStatus());
        for (var request : List.of(post("/api/v1/projects"), patch(path), post(path+"/archive"), get(path), get("/api/v1/projects")))
            assertEquals(401, mvc.perform(request).andReturn().getResponse().getStatus());
        jdbc.update("update users set is_active=false where id=?", actor.getId());
        assertEquals(401, mvc.perform(as(actor, get(path))).andReturn().getResponse().getStatus());
    }
}

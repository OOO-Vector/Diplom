package com.teamai.orchestrator;

import com.teamai.orchestrator.core.domain.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

class MembershipTests extends ProjectApiTestSupport {
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    com.teamai.orchestrator.core.application.MembershipService service;

    @Test void failedTransferRollsBackBothFlushedRoleChanges() throws Exception {
        var owner=actor();var successor=actor();var id=create(owner);fixtureMember(id,successor);
        com.teamai.orchestrator.core.application.MembershipService target=org.springframework.test.util.AopTestUtils.getUltimateTargetObject(service);
        org.mockito.Mockito.doAnswer(invocation -> {
            invocation.callRealMethod();
            assertEquals(successor.getId(),jdbc.queryForObject("select user_id from project_members where project_id=? and role='owner'",UUID.class,id));
            throw new IllegalStateException("Synthetic post-flush failure");
        }).when(target).transfer(org.mockito.ArgumentMatchers.eq(id),org.mockito.ArgumentMatchers.eq(successor.getId()));
        var response=mvc.perform(as(owner,body(post("/api/v1/projects/"+id+"/transfer-ownership"),Map.of("newOwnerUserId",successor.getId())))).andReturn().getResponse();
        assertEquals(500,response.getStatus());
        assertEquals("owner",members.findById(new ProjectMember.Id(id,owner.getId())).orElseThrow().getRole());
        assertEquals("member",members.findById(new ProjectMember.Id(id,successor.getId())).orElseThrow().getRole());oneOwner(id);
    }
    @Test void addsActiveUserCaseInsensitivelyListsSafePageAndRemovesAccess() throws Exception {
        var owner = actor(); var member = actor(); var id = create(owner); String path = "/api/v1/projects/"+id;
        var added = mvc.perform(as(owner, body(post(path+"/members"), Map.of("email", " "+member.getEmail().toUpperCase(Locale.ROOT)+" ")))).andReturn().getResponse();
        assertEquals(201, added.getStatus()); var dto = json.readTree(added.getContentAsString());
        assertEquals(4, dto.size()); assertEquals("member", dto.get("role").asString()); assertFalse(dto.has("email"));
        assertEquals(member.getId().toString(), dto.get("userId").asString());
        jdbc.update("update project_members set joined_at='2026-01-01T00:00:00Z' where project_id=?", id);
        var sorted = jdbc.queryForList("select user_id from project_members where project_id=? order by joined_at,user_id", UUID.class, id);
        for (int page=0; page<2; page++) {
            var response = mvc.perform(as(member, get(path+"/members").param("size", "1").param("page", ""+page))).andReturn().getResponse();
            assertEquals(200, response.getStatus()); var listing=json.readTree(response.getContentAsString());
            assertEquals(2, listing.get("totalElements").asInt()); assertEquals(2, listing.get("totalPages").asInt());
            assertEquals(sorted.get(page).toString(), listing.get("items").get(0).get("userId").asString());
            assertEquals(4, listing.get("items").get(0).size());
        }
        assertEquals(409, mvc.perform(as(owner, body(post(path+"/members"), Map.of("email", member.getEmail())))).andReturn().getResponse().getStatus());
        var removed = mvc.perform(as(owner, delete(path+"/members/"+member.getId()))).andReturn().getResponse();
        assertEquals(204, removed.getStatus()); assertEquals("", removed.getContentAsString());
        assertEquals(404, mvc.perform(as(member, get(path))).andReturn().getResponse().getStatus());
        assertEquals(404, mvc.perform(as(member, get(path+"/members"))).andReturn().getResponse().getStatus());
        var listing = json.readTree(mvc.perform(as(member, get("/api/v1/projects"))).andReturn().getResponse().getContentAsString());
        assertEquals(0, listing.get("totalElements").asInt()); oneOwner(id);
    }

    @Test void membershipAndNestedIdsCannotBypassScopeOrOwnerRole() throws Exception {
        var owner=actor(); var member=actor(); var outsider=actor(); var id=create(owner); fixtureMember(id, member);
        var foreign=create(outsider); String path="/api/v1/projects/"+id;
        for (var caller : List.of(member, outsider)) {
            int status = caller == member ? 403 : 404;
            assertEquals(status, mvc.perform(as(caller, body(post(path+"/members"), Map.of("email", outsider.getEmail())))).andReturn().getResponse().getStatus());
            assertEquals(status, mvc.perform(as(caller, delete(path+"/members/"+member.getId()))).andReturn().getResponse().getStatus());
            assertEquals(status, mvc.perform(as(caller, body(post(path+"/transfer-ownership"), Map.of("newOwnerUserId", member.getId())))).andReturn().getResponse().getStatus());
        }
        for (UUID target : List.of(id, UUID.randomUUID())) {
            var response = mvc.perform(as(outsider, get("/api/v1/projects/"+target+"/members"))).andReturn().getResponse();
            assertEquals(404,response.getStatus()); assertFalse(response.getContentAsString().contains("totalElements"));
        }
        assertEquals(404, mvc.perform(as(owner, delete(path+"/members/"+outsider.getId()))).andReturn().getResponse().getStatus());
        assertEquals(409, mvc.perform(as(owner, delete(path+"/members/"+owner.getId()))).andReturn().getResponse().getStatus());
        assertEquals(409, mvc.perform(as(owner, body(post(path+"/transfer-ownership"), Map.of("newOwnerUserId", outsider.getId())))).andReturn().getResponse().getStatus());
        oneOwner(id); oneOwner(foreign);
    }

    @Test void transferPreservesMembershipIdentityAndCreatorAndChangesAuthority() throws Exception {
        var owner=actor(); var target=actor(); var id=create(owner); fixtureMember(id,target); String path="/api/v1/projects/"+id;
        var before = jdbc.queryForList("select user_id,joined_at from project_members where project_id=? order by user_id", id);
        var response=mvc.perform(as(owner, body(post(path+"/transfer-ownership"), Map.of("newOwnerUserId",target.getId())))).andReturn().getResponse();
        assertEquals(200,response.getStatus()); var dto=json.readTree(response.getContentAsString());
        assertEquals("member",dto.get("myRole").asString()); assertEquals(owner.getId().toString(),dto.get("createdBy").asString());
        assertEquals(before,jdbc.queryForList("select user_id,joined_at from project_members where project_id=? order by user_id",id));
        assertEquals("member",members.findById(new ProjectMember.Id(id,owner.getId())).orElseThrow().getRole());
        assertEquals("owner",members.findById(new ProjectMember.Id(id,target.getId())).orElseThrow().getRole());
        assertEquals(403,mvc.perform(as(owner,body(patch(path),Map.of("name","Denied")))).andReturn().getResponse().getStatus());
        assertEquals(200,mvc.perform(as(target,body(patch(path),Map.of("name","New owner")))).andReturn().getResponse().getStatus()); oneOwner(id);
    }

    @Test void inactiveUnknownAndInvalidTargetsAndArchivedMutationsAreRejected() throws Exception {
        var owner=actor();var member=actor();var inactive=actor();var id=create(owner);fixtureMember(id,member);String path="/api/v1/projects/"+id;
        jdbc.update("update users set is_active=false where id=?",inactive.getId());
        for(String email:List.of(inactive.getEmail(),UUID.randomUUID()+"@example.test")) {
            var response=mvc.perform(as(owner,body(post(path+"/members"),Map.of("email",email)))).andReturn().getResponse();
            assertEquals(404,response.getStatus());assertEquals("USER_OR_PROJECT_NOT_FOUND",json.readTree(response.getContentAsString()).get("code").asString());
        }
        fixtureMember(id,inactive);
        for(UUID target:List.of(owner.getId(),inactive.getId(),UUID.randomUUID())) {
            var response=mvc.perform(as(owner,body(post(path+"/transfer-ownership"),Map.of("newOwnerUserId",target)))).andReturn().getResponse();
            assertEquals(409,response.getStatus());assertEquals("OWNERSHIP_CONFLICT",json.readTree(response.getContentAsString()).get("code").asString());
        }
        assertEquals(200,mvc.perform(as(owner,post(path+"/archive"))).andReturn().getResponse().getStatus());
        assertEquals(200,mvc.perform(as(member,get(path+"/members"))).andReturn().getResponse().getStatus());
        assertEquals(409,mvc.perform(as(owner,body(post(path+"/members"),Map.of("email",member.getEmail())))).andReturn().getResponse().getStatus());
        assertEquals(409,mvc.perform(as(owner,delete(path+"/members/"+member.getId()))).andReturn().getResponse().getStatus());
        assertEquals(409,mvc.perform(as(owner,body(post(path+"/transfer-ownership"),Map.of("newOwnerUserId",member.getId())))).andReturn().getResponse().getStatus());oneOwner(id);
    }

    @Test void everyMembershipWriteRejectsUnauthenticatedInvalidAndMassAssignmentInputs() throws Exception {
        var owner=actor();var member=actor();var id=create(owner);String path="/api/v1/projects/"+id;
        for(var request:List.of(post(path+"/members"),delete(path+"/members/"+member.getId()),post(path+"/transfer-ownership"),get(path+"/members")))
            assertEquals(401,mvc.perform(request).andReturn().getResponse().getStatus());
        for(String input:List.of("{}","{\"email\":\"bad\"}","{\"email\":null}","{\"email\":\""+member.getEmail()+"\",\"role\":\"owner\"}"))
            assertEquals(400,mvc.perform(as(owner,post(path+"/members").contentType("application/json").content(input))).andReturn().getResponse().getStatus());
        for(String input:List.of("{}","{\"newOwnerUserId\":null}","{\"newOwnerUserId\":\"1-1-1-1-1\"}","{\"newOwnerUserId\":\""+member.getId()+"\",\"role\":\"owner\"}"))
            assertEquals(400,mvc.perform(as(owner,post(path+"/transfer-ownership").contentType("application/json").content(input))).andReturn().getResponse().getStatus());
        assertEquals(400,mvc.perform(as(owner,delete(path+"/members/bad"))).andReturn().getResponse().getStatus());
        assertEquals(400,mvc.perform(as(owner,body(delete(path+"/members/"+member.getId()),Map.of()))).andReturn().getResponse().getStatus());
        assertEquals(400,mvc.perform(as(owner,get(path+"/members").param("size","101"))).andReturn().getResponse().getStatus());
        for(String route:List.of("/members","/transfer-ownership"))
            assertEquals(413,mvc.perform(as(owner,post(path+route).contentType("application/json").content(" ".repeat(32769)))).andReturn().getResponse().getStatus());
        oneOwner(id);assertEquals(1,members.countInProject(id));
    }
}

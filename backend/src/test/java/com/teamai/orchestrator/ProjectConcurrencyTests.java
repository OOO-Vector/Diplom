package com.teamai.orchestrator;

import com.teamai.orchestrator.core.domain.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

class ProjectConcurrencyTests extends ProjectApiTestSupport {
    Connection lock(UUID project) throws Exception {
        var connection=DriverManager.getConnection(DATABASE.getJdbcUrl(),"team_ai_app",APP_PASSWORD);connection.setAutoCommit(false);
        try(var statement=connection.prepareStatement("select id from projects where id=? for update")) {
            statement.setObject(1,project);statement.executeQuery().close();
        }
        return connection;
    }
    void waiters(Connection held,int count) throws Exception {
        int blocker;
        try(var statement=held.createStatement();var result=statement.executeQuery("select pg_backend_pid()")) {result.next();blocker=result.getInt(1);}
        try(var observer=DriverManager.getConnection(DATABASE.getJdbcUrl(),DATABASE.getUsername(),DATABASE.getPassword());
            var query=observer.prepareStatement("""
                    with recursive blocked(pid) as (
                      select pid from pg_stat_activity where ? = any(pg_blocking_pids(pid))
                      union select p.pid from pg_stat_activity p join blocked b on b.pid = any(pg_blocking_pids(p.pid))
                    ) select count(*) from blocked
                    """)) {
            query.setInt(1,blocker);long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
            do {try(var result=query.executeQuery()) {result.next();if(result.getInt(1)>=count)return;}Thread.sleep(20);}
            while(System.nanoTime()<deadline);
            fail("Project mutations did not reach actual PostgreSQL lock waits");
        }
    }
    List<MockHttpServletResponse> race(UUID project,MockHttpServletRequestBuilder first,MockHttpServletRequestBuilder second) throws Exception {
        try(var pool=Executors.newFixedThreadPool(2);var held=lock(project)) {
            var a=pool.submit(()->mvc.perform(first).andReturn().getResponse());
            Future<MockHttpServletResponse> b;
            try {waiters(held,1);b=pool.submit(()->mvc.perform(second).andReturn().getResponse());waiters(held,2);}
            finally {held.commit();}
            return List.of(a.get(15,TimeUnit.SECONDS),b.get(15,TimeUnit.SECONDS));
        }
    }
    MockHttpServletRequestBuilder transfer(User owner,UUID project,User target) {
        return as(owner,body(post("/api/v1/projects/"+project+"/transfer-ownership"),Map.of("newOwnerUserId",target.getId())));
    }
    @Test void competingTransfersRecheckOwnerAfterLockAndNeverCreateTwoOwners() throws Exception {
        var owner=actor();var a=actor();var b=actor();var id=create(owner);fixtureMember(id,a);fixtureMember(id,b);
        var results=race(id,transfer(owner,id,a),transfer(owner,id,b));
        assertEquals(List.of(200,403),results.stream().map(MockHttpServletResponse::getStatus).sorted().toList());
        oneOwner(id);assertEquals(owner.getId(),projects.findById(id).orElseThrow().getCreatedBy());
        assertEquals("member",members.findById(new ProjectMember.Id(id,owner.getId())).orElseThrow().getRole());
    }
    @Test void removalAndTransferOfSameTargetSerializeWithoutOwnerlessProject() throws Exception {
        for(boolean removeFirst:List.of(true,false)) {
            var owner=actor();var target=actor();var id=create(owner);fixtureMember(id,target);
            var removal=as(owner,delete("/api/v1/projects/"+id+"/members/"+target.getId()));var transfer=transfer(owner,id,target);
            var results=race(id,removeFirst?removal:transfer,removeFirst?transfer:removal);
            var statuses=results.stream().map(MockHttpServletResponse::getStatus).sorted().toList();
            assertTrue(statuses.equals(List.of(204,409))||statuses.equals(List.of(200,403)),statuses.toString());oneOwner(id);
            if(statuses.contains(204))assertTrue(members.findById(new ProjectMember.Id(id,target.getId())).isEmpty());
            else assertEquals("owner",members.findById(new ProjectMember.Id(id,target.getId())).orElseThrow().getRole());
        }
    }
    @Test void duplicateConcurrentAddsProduceOneMembershipAndConflict() throws Exception {
        var owner=actor();var target=actor();var id=create(owner);String path="/api/v1/projects/"+id+"/members";
        var results=race(id,as(owner,body(post(path),Map.of("email",target.getEmail()))),as(owner,body(post(path),Map.of("email",target.getEmail().toUpperCase(Locale.ROOT)))));
        assertEquals(List.of(201,409),results.stream().map(MockHttpServletResponse::getStatus).sorted().toList());
        assertEquals(2,members.countInProject(id));oneOwner(id);
    }
    @Test void archiveRacesWithPatchAddAndTransferOnlyAllowValidSerialOutcomes() throws Exception {
        for(String operation:List.of("patch","add","transfer")) {
            var owner=actor();var target=actor();var id=create(owner);String path="/api/v1/projects/"+id;
            if(operation.equals("transfer"))fixtureMember(id,target);
            var command=switch(operation) {
                case "patch"->as(owner,body(patch(path),Map.of("name","Changed")));
                case "add"->as(owner,body(post(path+"/members"),Map.of("email",target.getEmail())));
                default->transfer(owner,id,target);
            };
            var responses=race(id,as(owner,post(path+"/archive")),command);
            int archived=responses.get(0).getStatus(), mutated=responses.get(1).getStatus();
            if(operation.equals("transfer")) {
                assertTrue((archived==200&&mutated==409)||(archived==403&&mutated==200));
                assertEquals(archived==200?"archived":"active",projects.findById(id).orElseThrow().getStatus());
            } else {
                assertEquals(200,archived);assertTrue(mutated==409||mutated==(operation.equals("add")?201:200));
                assertEquals("archived",projects.findById(id).orElseThrow().getStatus());
                if(operation.equals("patch"))assertEquals(mutated==200?"Changed":"Project",projects.findById(id).orElseThrow().getName());
                else assertEquals(mutated==201?2:1,members.countInProject(id));
            }
            oneOwner(id);
        }
    }
    @Test void blockedWritesReReadCommittedArchivedStatusAndUnrelatedProjectProgresses() throws Exception {
        var owner=actor();var id=create(owner);var other=create(owner);
        try(var pool=Executors.newFixedThreadPool(2);var held=lock(id)) {
            var blocked=pool.submit(()->mvc.perform(as(owner,body(patch("/api/v1/projects/"+id),Map.of("name","Forbidden")))).andReturn().getResponse());
            try {
                waiters(held,1);
                var independent=pool.submit(()->mvc.perform(as(owner,body(patch("/api/v1/projects/"+other),Map.of("name","Independent")))).andReturn().getResponse());
                assertEquals(200,independent.get(10,TimeUnit.SECONDS).getStatus());assertFalse(blocked.isDone());
                try(var update=held.prepareStatement("update projects set status='archived' where id=?")) {update.setObject(1,id);update.executeUpdate();}
            } finally {held.commit();}
            assertEquals(409,blocked.get(10,TimeUnit.SECONDS).getStatus());assertEquals("Project",projects.findById(id).orElseThrow().getName());oneOwner(id);
        }
    }
}

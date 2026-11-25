package com.teamai.orchestrator;

import com.atlassian.oai.validator.model.*;
import com.teamai.orchestrator.core.domain.User;
import com.teamai.orchestrator.planning.persistence.SpecificationRepository;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.font.*;
import org.apache.pdfbox.pdmodel.encryption.*;
import org.apache.pdfbox.pdmodel.graphics.image.LosslessFactory;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

class SpecificationTests extends ProjectApiTestSupport {
    @MockitoSpyBean SpecificationRepository specifications;
    String path(UUID project) { return "/api/v1/projects/" + project + "/specifications"; }
    org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder upload(User actor, UUID project, byte[] data, String filename, String type) {
        var file = new org.springframework.mock.web.MockPart("file", filename, data);
        file.getHeaders().setContentType(org.springframework.http.MediaType.parseMediaType(type));
        return multipart(path(project)).part(file, new org.springframework.mock.web.MockPart("title", " Specification ".getBytes(StandardCharsets.UTF_8))).header("Authorization", "Bearer " + tokens.issue(actor.getId()));
    }
    org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder txt(User actor, UUID project, String text) {
        return upload(actor, project, text.getBytes(StandardCharsets.UTF_8), "requirements.txt", "text/plain;charset=UTF-8");
    }
    MockHttpServletResponse check(org.springframework.test.web.servlet.RequestBuilder request, int status) throws Exception {
        var result = mvc.perform(request).andReturn(); var response = result.getResponse();
        assertEquals(status, response.getStatus());
        var modeled = SimpleResponse.Builder.status(status);
        response.getHeaderNames().forEach(name -> modeled.withHeader(name, response.getHeaders(name)));
        if (!response.getContentAsString().isEmpty()) modeled.withBody(response.getContentAsString());
        var report = CoreContractTests.CONTRACT.validateResponse(result.getRequest().getRequestURI(),
                Request.Method.valueOf(result.getRequest().getMethod()), modeled.build());
        assertFalse(report.hasErrors(), () -> report.getMessages().stream().map(m -> m.getKey()).distinct().toList().toString());
        if (status >= 400) {
            assertTrue(response.getContentType().startsWith("application/problem+json"));
            assertDoesNotThrow(() -> UUID.fromString(json.readTree(response.getContentAsString()).get("correlationId").asString()));
        }
        return response;
    }
    static byte[] pdf(boolean image, String password) throws Exception {
        // Synthetic fixture generated from committed test source; no real documents or font files.
        try (var document = new PDDocument(); var output = new ByteArrayOutputStream()) {
            var page = new PDPage(); document.addPage(page);
            try (var content = new PDPageContentStream(document, page)) {
                if (image) content.drawImage(LosslessFactory.createFromImage(document, new BufferedImage(2,2,BufferedImage.TYPE_INT_RGB)), 20,20);
                else {
                    content.beginText(); content.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                    content.newLineAtOffset(20,700); content.showText("Synthetic specification requirements."); content.endText();
                }
            }
            if (password != null) document.protect(new StandardProtectionPolicy("synthetic-owner", password, new AccessPermission()));
            document.save(output); return output.toByteArray();
        }
    }
    @Test void importsTxtAndPdfPreservesHistoryAndReturnsSafeContract() throws Exception {
        var owner=actor(); var member=actor(); var project=create(owner); fixtureMember(project,member);
        var first=check(upload(member,project,"\uFEFFПривет 😀\nKeep this history".getBytes(StandardCharsets.UTF_8),"C:\\fakepath\\req\u202E.txt","text/plain"),201);
        var a=json.readTree(first.getContentAsString()); assertEquals(8,a.size()); assertFalse(a.has("content"));
        assertEquals(member.getId().toString(),a.get("uploadedBy").asString()); assertEquals(1,a.get("version").asInt());
        assertEquals("req_.txt",a.get("originalFilename").asString()); assertEquals("Specification",a.get("title").asString());
        var second=check(upload(owner,project,pdf(false,null),"requirements.pdf","application/pdf"),201);
        var b=json.readTree(second.getContentAsString()); assertEquals(2,b.get("version").asInt());
        var oldText=check(as(owner,get(first.getHeader("Location")+"/text")),200);
        assertEquals("Привет 😀\nKeep this history",oldText.getContentAsString(StandardCharsets.UTF_8));
        assertEquals("nosniff",oldText.getHeader("X-Content-Type-Options")); assertEquals("no-store",oldText.getHeader("Cache-Control"));
        String pdfText=check(as(member,get(second.getHeader("Location")+"/text")),200).getContentAsString();
        assertTrue(pdfText.contains("Synthetic specification"));assertFalse(pdfText.contains("\r"));
        check(as(member,get(first.getHeader("Location"))),200);
        var page=json.readTree(check(as(owner,get(path(project)).param("size","1")),200).getContentAsString());
        assertEquals(2,page.get("totalElements").asInt()); assertEquals(2,page.get("totalPages").asInt());
        assertEquals(2,page.get("items").get(0).get("version").asInt());
        assertEquals(0,json.readTree(check(as(owner,get(path(project)).param("page","100")),200).getContentAsString()).get("items").size());
    }
    @Test void rejectsInvalidPdfTextAndContentMismatchWithoutRows() throws Exception {
        var actor=actor(); var project=create(actor);
        for (byte[] bytes : List.of(new byte[0],new byte[]{(byte)0xC3,0x28}," \t\n\u00A0".getBytes(StandardCharsets.UTF_8),new byte[]{0},"%PDF-pretending".getBytes()))
            check(upload(actor,project,bytes,"x.txt","text/plain"),400);
        for (byte[] bytes : List.of(pdf(true,null),pdf(false,""),pdf(false,"synthetic-password"),"%PDF-broken".getBytes(),"not a pdf".getBytes()))
            check(upload(actor,project,bytes,"x.pdf","application/pdf"),400);
        check(upload(actor,project,"text".getBytes(),"x.pdf","text/plain"),415);
        check(upload(actor,project,"text".getBytes(),"x.txt","application/octet-stream"),415);
        check(upload(actor,project,"text".getBytes(),"x.txt","text/plain;charset=ISO-8859-1"),415);
        assertEquals(0,specifications.count(project));
    }
    @Test void enforcesByteAndUnicodeLimitsIncludingStreamsWithoutLength() throws Exception {
        var actor=actor(); var project=create(actor);
        String limit="😀".repeat(200000);
        check(txt(actor,project,limit),201); check(txt(actor,project,limit+"x"),413);
        byte[] tooBig=new byte[10*1024*1024+1]; Arrays.fill(tooBig,(byte)'x');
        check(upload(actor,project,tooBig,"x.txt","text/plain"),413);
        var streamedError=assertThrows(com.teamai.orchestrator.core.application.CoreException.class,()->new com.teamai.orchestrator.planning.application.SpecificationExtractor()
                .extract(new ByteArrayInputStream(tooBig),-1,"text/plain","x.txt"));
        assertEquals(413,streamedError.status());assertEquals("PAYLOAD_TOO_LARGE",streamedError.code());
        assertEquals(1,specifications.count(project));
    }
    @Test void enforcesMembershipNestedScopeArchivedStateAndActiveUser() throws Exception {
        var owner=actor();var member=actor();var outsider=actor();var project=create(owner);var foreign=create(outsider);fixtureMember(project,member);
        var created=check(txt(member,project,"history"),201);String location=created.getHeader("Location");
        String id=json.readTree(created.getContentAsString()).get("id").asString();
        check(get(path(project)),401);check(post(path(project)).contentType("text/plain").content("x"),401);
        check(txt(outsider,project,"hidden"),404);check(as(outsider,get(path(project))),404);
        check(as(outsider,get(location)),404);check(as(outsider,get(location+"/text")),404);
        check(as(outsider,get(path(foreign)+"/"+id)),404);check(as(outsider,get(path(foreign)+"/"+id+"/text")),404);
        assertEquals(204,mvc.perform(as(owner,delete("/api/v1/projects/"+project+"/members/"+member.getId()))).andReturn().getResponse().getStatus());
        check(as(member,get(location)),404);check(txt(member,project,"removed"),404);
        assertEquals(200,mvc.perform(as(owner,post("/api/v1/projects/"+project+"/archive"))).andReturn().getResponse().getStatus());
        check(txt(owner,project,"archived"),409);check(as(owner,get(location)),200);check(as(owner,get(location+"/text")),200);
        jdbc.update("update users set is_active=false where id=?",owner.getId());check(as(owner,get(location)),401);
        assertEquals(1,specifications.count(project));
    }
    @Test void validatesMetadataAndDoesNotTrustOwnershipParameters() throws Exception {
        var actor=actor();var project=create(actor);
        check(multipart(path(project)).part(new org.springframework.mock.web.MockPart("file","x.txt",new byte[]{120})).header("Authorization", "Bearer " + tokens.issue(actor.getId())),400);
        check(txt(actor,project,"x").queryParam("title","extra"),400);
        check(upload(actor,project,"x".getBytes(),"x".repeat(256)+".txt","text/plain"),400);
        check(as(actor,get(path(project)).param("size","101")),400);
        check(txt(actor,project,"untrusted attribution").queryParam("version","900").queryParam("uploadedBy",UUID.randomUUID().toString()),400);
        var response=check(txt(actor,project,"trusted server attribution"),201);
        var result=json.readTree(response.getContentAsString());assertEquals(1,result.get("version").asInt());assertEquals(actor.getId().toString(),result.get("uploadedBy").asString());
    }
    @Test void rollbackAfterInsertLeavesNoPartialRowOrVersionGap() throws Exception {
        var actor=actor();var project=create(actor);
        doAnswer(call -> {call.callRealMethod();throw new IllegalStateException("synthetic persistence failure");}).when(specifications).insert(any(),anyString());
        check(txt(actor,project,"rollback"),500);assertEquals(0,specifications.count(project));
        reset(specifications);var response=check(txt(actor,project,"retry"),201);
        assertEquals(1,json.readTree(response.getContentAsString()).get("version").asInt());
    }
    @Test void concurrentUploadsSerializeVersionAllocationUnderRealProjectLock() throws Exception {
        var actor=actor();var project=create(actor);
        try(var held=DriverManager.getConnection(DATABASE.getJdbcUrl(),"team_ai_app",APP_PASSWORD);
            var pool=Executors.newFixedThreadPool(2)) {
            held.setAutoCommit(false);
            try(var lock=held.prepareStatement("select id from projects where id=? for update")) {lock.setObject(1,project);lock.executeQuery().close();}
            var a=pool.submit(()->check(txt(actor,project,"first concurrent content"),201));
            var b=pool.submit(()->check(txt(actor,project,"second concurrent content"),201));
            try { awaitWaiters(held,2); } finally {held.commit();}
            Set<Integer> versions=new HashSet<>();
            for(var response:List.of(a.get(20,TimeUnit.SECONDS),b.get(20,TimeUnit.SECONDS))) versions.add(json.readTree(response.getContentAsString()).get("version").asInt());
            assertEquals(Set.of(1,2),versions);assertEquals(2,specifications.count(project));
            assertEquals(2,jdbc.queryForObject("select count(distinct content) from specifications where project_id=?",Integer.class,project));
        }
    }
    void awaitWaiters(Connection held,int count) throws Exception {
        int pid;try(var st=held.createStatement();var rs=st.executeQuery("select pg_backend_pid()")){rs.next();pid=rs.getInt(1);}
        try(var observer=DriverManager.getConnection(DATABASE.getJdbcUrl(),DATABASE.getUsername(),DATABASE.getPassword());
            var query=observer.prepareStatement("with recursive blocked(pid) as (select pid from pg_stat_activity where ?=any(pg_blocking_pids(pid)) union select p.pid from pg_stat_activity p join blocked b on b.pid=any(pg_blocking_pids(p.pid))) select count(*) from blocked")) {
            query.setInt(1,pid);long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
            do {try(var result=query.executeQuery()){result.next();if(result.getInt(1)>=count)return;}Thread.sleep(20);}while(System.nanoTime()<deadline);
            fail("Uploads did not reach PostgreSQL lock waits");
        }
    }
    @Test void rechecksArchiveAndMembershipAfterWaitingForProjectLock() throws Exception {
        for (boolean archive : List.of(true,false)) {
            var owner=actor();var member=actor();var project=create(owner);fixtureMember(project,member);
            try(var held=DriverManager.getConnection(DATABASE.getJdbcUrl(),"team_ai_app",APP_PASSWORD);
                var pool=Executors.newSingleThreadExecutor()) {
                held.setAutoCommit(false);
                try(var lock=held.prepareStatement("select id from projects where id=? for update")) {lock.setObject(1,project);lock.executeQuery().close();}
                var upload=pool.submit(()->check(txt(member,project,"must not persist"),archive?409:404));
                try {
                    awaitWaiters(held,1);
                    try(var update=held.prepareStatement(archive ? "update projects set status='archived',updated_at=greatest(updated_at,now()) where id=?"
                            : "delete from project_members where project_id=? and user_id=?")) {
                        update.setObject(1,project); if(!archive)update.setObject(2,member.getId()); update.executeUpdate();
                    }
                } finally {held.commit();}
                upload.get(20,TimeUnit.SECONDS);assertEquals(0,specifications.count(project));
            }
        }
    }
}

package com.teamai.orchestrator;

import com.teamai.orchestrator.core.domain.User;
import org.junit.jupiter.api.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Actual servlet multipart parsing/limits/cleanup; MockMvc multipart builders bypass those limits. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SpecificationMultipartHttpTests extends ProjectApiTestSupport {
    @LocalServerPort int port;
    static final Path UPLOADS = tempDirectory();
    static Path tempDirectory() {
        try { return Files.createTempDirectory("specification-multipart-test-"); }
        catch (IOException ex) { throw new ExceptionInInitializerError(ex); }
    }
    @DynamicPropertySource static void multipartLocation(DynamicPropertyRegistry registry) {
        registry.add("spring.servlet.multipart.location", () -> UPLOADS.toString());
    }
    record Field(String name, String filename, String type, byte[] bytes) {}
    Field title() { return new Field("title",null,"text/plain;charset=UTF-8","Multipart title".getBytes(StandardCharsets.UTF_8)); }
    Field file(byte[] bytes, String name, String type) { return new Field("file",name,type,bytes); }
    byte[] encode(List<Field> fields) throws IOException {
        var output=new ByteArrayOutputStream();
        for(var field:fields) {
            String header="--test-boundary\r\nContent-Disposition: form-data; name=\""+field.name()+"\""
                    +(field.filename()==null?"":"; filename=\""+field.filename()+"\"")
                    +"\r\nContent-Type: "+field.type()+"\r\n\r\n";
            output.write(header.getBytes(StandardCharsets.UTF_8));output.write(field.bytes());output.write("\r\n".getBytes(StandardCharsets.US_ASCII));
        }
        output.write("--test-boundary--\r\n".getBytes(StandardCharsets.US_ASCII));return output.toByteArray();
    }
    HttpResponse<String> send(User actor, UUID project, List<Field> fields, int expected) throws Exception {
        return send(actor,project,encode(fields),"multipart/form-data; boundary=test-boundary",expected,false);
    }
    HttpResponse<String> send(User actor, UUID project, byte[] bytes, String type, int expected, boolean chunked) throws Exception {
        try(var client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()) {
            var publisher=chunked ? HttpRequest.BodyPublishers.ofInputStream(()->new ByteArrayInputStream(bytes)) : HttpRequest.BodyPublishers.ofByteArray(bytes);
            var request=HttpRequest.newBuilder(URI.create("http://localhost:"+port+"/api/v1/projects/"+project+"/specifications"))
                    .timeout(Duration.ofSeconds(30)).header("Content-Type",type).POST(publisher);
            if(actor!=null)request.header("Authorization","Bearer "+tokens.issue(actor.getId()));
            var response=client.send(request.build(),HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            assertEquals(expected,response.statusCode());
            var modeled=com.atlassian.oai.validator.model.SimpleResponse.Builder.status(expected).withBody(response.body());
            response.headers().map().forEach(modeled::withHeader);
            var report=CoreContractTests.CONTRACT.validateResponse("/api/v1/projects/"+project+"/specifications",
                    com.atlassian.oai.validator.model.Request.Method.POST,modeled.build());
            assertFalse(report.hasErrors(),()->report.getMessages().stream().map(m->m.getKey()).distinct().toList().toString());
            if(expected>=400) {
                assertTrue(response.headers().firstValue("Content-Type").orElseThrow().startsWith("application/problem+json"));
                var problem=json.readTree(response.body());assertEquals(expected,problem.get("status").asInt());
                UUID.fromString(problem.get("correlationId").asString());
                if(expected==413)assertEquals("PAYLOAD_TOO_LARGE",problem.get("code").asString());
            }
            return response;
        }
    }
    @AfterEach void stagedFilesAreRemoved() {
        org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(5)).until(()-> {
            try(var files=Files.list(UPLOADS)){return files.findAny().isEmpty();}
        });
    }
    @AfterAll static void removeEmptyUploadDirectory() throws IOException { Files.delete(UPLOADS); }

    @Test void servletAcceptsTxtAndPdfAndAllocatesVersions() throws Exception {
        var owner=actor();var project=create(owner);
        var txt=send(owner,project,List.of(title(),file("Привет 😀".getBytes(StandardCharsets.UTF_8),"requirements.txt","text/plain")),201);
        var pdf=send(owner,project,List.of(title(),file(SpecificationTests.pdf(false,null),"requirements.pdf","application/pdf")),201);
        assertEquals(1,json.readTree(txt.body()).get("version").asInt());assertEquals(2,json.readTree(pdf.body()).get("version").asInt());
        assertEquals("requirements.pdf",json.readTree(pdf.body()).get("originalFilename").asString());
        String unicodeName="😀".repeat(200)+".txt";
        var unicode=send(owner,project,List.of(title(),file(new byte[]{120},unicodeName,"text/plain")),201);
        assertEquals(unicodeName,json.readTree(unicode.body()).get("originalFilename").asString());
        assertEquals(3,jdbc.queryForObject("select count(*) from specifications where project_id=?",Integer.class,project));
    }
    @Test void rejectsMissingDuplicateAndWronglyTypedPartsAndLegacyTransport() throws Exception {
        var owner=actor();var project=create(owner);var file=file(new byte[]{120},"x.txt","text/plain");
        for(var fields:List.of(List.of(title()),List.of(file),List.of(title(),title(),file),List.of(title(),file,file),
                List.of(title(),new Field("other","x.txt","text/plain",new byte[]{120})),
                List.of(new Field("title","title.txt","text/plain",new byte[]{120}),file)))send(owner,project,fields,400);
        send(owner,project,List.of(title(),file(new byte[]{120},"x.exe","application/octet-stream")),415);
        send(owner,project,new byte[]{120},"text/plain",415,false);
        send(owner,project,"broken".getBytes(StandardCharsets.UTF_8),"multipart/form-data",400,false);
        send(owner,project,List.of(new Field("title",null,"text/plain",new byte[]{(byte)0xC3,0x28}),file),400);
        send(owner,project,List.of(new Field("title",null,"text/plain",new byte[801]),file),400);
        assertEquals(0,jdbc.queryForObject("select count(*) from specifications where project_id=?",Integer.class,project));
    }
    @Test void servletRejectsOversizedFileAndAggregateIncludingChunkedRequests() throws Exception {
        var owner=actor();var project=create(owner);
        // Exactly 10 MiB plus multipart overhead reaches content validation, not servlet 413.
        byte[] exactLimit=new byte[10*1024*1024];exactLimit[0]=(byte)0xFF; // Malformed UTF-8, before text-length validation.
        var boundary=send(owner,project,List.of(title(),file(exactLimit,"boundary.txt","text/plain")),400);
        assertEquals("INVALID_SPECIFICATION",json.readTree(boundary.body()).get("code").asString());
        var file=encode(List.of(title(),file(new byte[10*1024*1024+1],"big.txt","text/plain")));
        send(owner,project,file,"multipart/form-data; boundary=test-boundary",413,false);
        send(owner,project,file,"multipart/form-data; boundary=test-boundary",413,true);
        var aggregate=encode(List.of(title(),file(new byte[6*1024*1024],"a.txt","text/plain"),file(new byte[6*1024*1024],"b.txt","text/plain")));
        send(owner,project,aggregate,"multipart/form-data; boundary=test-boundary",413,false);
        assertEquals(0,jdbc.queryForObject("select count(*) from specifications where project_id=?",Integer.class,project));
    }
    @Test void multipartRetainsAuthenticationMembershipAndArchiveChecks() throws Exception {
        var owner=actor();var outsider=actor();var project=create(owner);var fields=List.of(title(),file(new byte[]{120},"x.txt","text/plain"));
        send(null,project,fields,401);send(outsider,project,fields,404);
        jdbc.update("update projects set status='archived' where id=?",project);send(owner,project,fields,409);
        assertEquals(0,jdbc.queryForObject("select count(*) from specifications where project_id=?",Integer.class,project));
    }
}

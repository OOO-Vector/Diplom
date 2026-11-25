package com.teamai.orchestrator;

import com.atlassian.oai.validator.OpenApiInteractionValidator;
import com.atlassian.oai.validator.model.Request;
import com.atlassian.oai.validator.model.SimpleResponse;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import java.nio.file.Path;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** Real MVC/security/services/database responses checked against the repository OpenAPI. */
class CoreContractTests extends ProjectApiTestSupport {
    static final OpenApiInteractionValidator CONTRACT = OpenApiInteractionValidator
            .createForSpecificationUrl(Path.of("../docs/api/openapi.yaml").toAbsolutePath().toUri().toString()).build();

    MockHttpServletResponse parity(MockHttpServletRequestBuilder request, int expected) throws Exception {
        var result = mvc.perform(request).andReturn();
        var response = result.getResponse();
        assertEquals(expected, response.getStatus()); // Never accept an accidental 500 as a negative test.
        var modeled = SimpleResponse.Builder.status(response.getStatus());
        response.getHeaderNames().forEach(name -> modeled.withHeader(name, response.getHeaders(name)));
        if (!response.getContentAsString().isEmpty()) modeled.withBody(response.getContentAsString());
        var report = CONTRACT.validateResponse(result.getRequest().getRequestURI(),
                Request.Method.valueOf(result.getRequest().getMethod()), modeled.build());
        assertFalse(report.hasErrors(), () -> report.getMessages().stream()
                .map(message -> message.getKey()).distinct().toList().toString());
        if (expected >= 400) {
            assertTrue(response.getContentType().startsWith("application/problem+json"));
            var problem = json.readTree(response.getContentAsString());
            assertEquals(expected, problem.get("status").asInt());
            assertDoesNotThrow(() -> UUID.fromString(problem.get("correlationId").asString()));
            if (expected == 401 && !result.getRequest().getRequestURI().startsWith("/api/v1/auth/")) {
                assertTrue(response.getHeader("WWW-Authenticate").startsWith("Bearer"));
            }
        }
        return response;
    }

    MockHttpServletRequestBuilder browserPost(String path, Csrf csrf) {
        return post(path).secure(true).header("Origin", ORIGIN).cookie(csrf.cookie())
                .header("X-CSRF-Token", csrf.token()).with(r -> { r.setRemoteAddr("2001:db8:" + UUID.randomUUID()); return r; });
    }

    @Test void authenticationResponsesMatchContract() throws Exception {
        parity(get("/api/v1/auth/csrf").secure(true), 200);
        var email = UUID.randomUUID() + "@example.test";
        parity(registration(body(email), csrf()), 201);
        parity(registration(body(email), csrf()), 409);
        parity(registration(body("invalid"), csrf()), 400);
        parity(post("/api/v1/auth/register"), 403);
        parity(body(browserPost("/api/v1/auth/login", csrf()), Map.of("email", email, "password", "incorrect")), 401);
        var login = parity(body(browserPost("/api/v1/auth/login", csrf()), Map.of("email", email, "password", PASSWORD)), 200);
        var access = json.readTree(login.getContentAsString()).get("accessToken").asString();
        parity(get("/api/v1/users/me").header("Authorization", "Bearer " + access), 200);
        parity(get("/api/v1/users/me"), 401);
        var refreshed = parity(browserPost("/api/v1/auth/refresh", csrf()).cookie(login.getCookie("refresh_token")), 200);
        parity(browserPost("/api/v1/auth/logout", csrf()).cookie(refreshed.getCookie("refresh_token")), 204);
        parity(browserPost("/api/v1/auth/refresh", csrf()).cookie(refreshed.getCookie("refresh_token")), 401);
    }

    @Test void projectAndMembershipResponsesMatchContract() throws Exception {
        var owner = actor(); var member = actor();
        var created = parity(as(owner, body(post("/api/v1/projects"), Map.of("name", "Contract project"))), 201);
        var path = "/api/v1/projects/" + json.readTree(created.getContentAsString()).get("id").asString();
        parity(as(owner, get("/api/v1/projects")), 200);
        parity(as(owner, get(path)), 200);
        parity(as(owner, body(patch(path), Map.of("description", "Updated"))), 200);
        parity(as(owner, body(post(path + "/members"), Map.of("email", member.getEmail()))), 201);
        parity(as(owner, get(path + "/members")), 200);
        parity(as(owner, delete(path + "/members/" + member.getId())), 204);
        parity(as(member, get(path)), 404);
        parity(as(owner, body(post(path + "/members"), Map.of("email", member.getEmail()))), 201);
        parity(as(owner, body(post(path + "/transfer-ownership"), Map.of("newOwnerUserId", member.getId().toString()))), 200);
        parity(as(owner, post(path + "/archive")), 403);
        parity(as(member, post(path + "/archive")), 200);
        parity(as(member, body(patch(path), Map.of("name", "Archived"))), 409);
    }

    @Test void controlledErrorsMatchProblemContract() throws Exception {
        var actor = actor();
        parity(as(actor, get("/api/v1/projects/not-a-uuid")), 400);
        parity(as(actor, get("/api/v1/projects").param("page", "wrong")), 400);
        parity(as(actor, get("/api/v1/projects/" + UUID.randomUUID())), 404);
        parity(as(actor, post("/api/v1/projects").contentType("text/plain").content("x")), 415);
        parity(as(actor, post("/api/v1/projects").contentType("application/json").content("x".repeat(32769))), 413);
        parity(get("/api/v1/projects").header("Authorization", "Bearer invalid"), 401);
        var email = UUID.randomUUID() + "@example.test";
        var csrf = csrf();
        for (int i = 0; i < 5; i++) parity(body(browserPost("/api/v1/auth/login", csrf), Map.of("email", email, "password", "incorrect")), 401);
        var limited = parity(body(browserPost("/api/v1/auth/login", csrf), Map.of("email", email, "password", "incorrect")), 429);
        assertNotNull(limited.getHeader("Retry-After"));
    }

    @Test void validatorRejectsMissingRequiredFieldsWrongTypesMediaAndUndocumentedStatus() {
        for (var response : List.of(
                SimpleResponse.Builder.status(200).withContentType("application/json").withBody("{}").build(),
                SimpleResponse.Builder.status(200).withContentType("application/json").withBody("[]").build(),
                SimpleResponse.Builder.status(200).withContentType("text/plain").withBody("text").build(),
                SimpleResponse.Builder.status(418).withContentType("application/json").withBody("{}").build())) {
            assertTrue(CONTRACT.validateResponse("/api/v1/users/me", Request.Method.GET, response).hasErrors());
        }
    }

    @Test void ordinaryRoutingFailuresAreGenericProblemsRatherThanServerErrors() throws Exception {
        var actor = actor();
        for (var entry : List.of(Map.entry(put("/api/v1/projects"), 405),
                Map.entry(get("/api/v1/projects").accept("application/xml"), 406),
                Map.entry(get("/api/v1/projects/" + UUID.randomUUID() + "/unknown"), 404),
                Map.entry(get("/api/v1/unknown"), 403))) {
            var response = mvc.perform(as(actor, entry.getKey())).andReturn().getResponse();
            assertEquals(entry.getValue(), response.getStatus());
            assertTrue(response.getContentType().startsWith("application/problem+json"));
            assertEquals(response.getStatus(), json.readTree(response.getContentAsString()).get("status").asInt());
            assertDoesNotThrow(() -> UUID.fromString(json.readTree(response.getContentAsString()).get("correlationId").asString()));
            if (response.getStatus() == 405) assertTrue(response.getHeader("Allow").contains("GET"));
        }
    }

    @Test void corsRejectionsAlsoUseSafeProblemDetailsAndKeepAllowedPreflight() throws Exception {
        parity(get("/api/v1/auth/csrf").header("Origin", "https://foreign.example.test"), 403);
        for (var request : List.of(get("/api/v1/auth/csrf").header("Origin", "https://foreign.example.test"),
                options("/api/v1/auth/login").header("Origin", "https://foreign.example.test")
                        .header("Access-Control-Request-Method", "POST"),
                options("/api/v1/auth/login").header("Origin", ORIGIN)
                        .header("Access-Control-Request-Method", "POST").header("Access-Control-Request-Headers", "X-Forbidden"))) {
            var response = mvc.perform(request).andReturn().getResponse();
            assertEquals(403, response.getStatus());
            assertTrue(response.getContentType().startsWith("application/problem+json"));
            assertEquals("no-store", response.getHeader("Cache-Control"));
            assertEquals("CSRF_INVALID", json.readTree(response.getContentAsString()).get("code").asString());
            assertDoesNotThrow(() -> UUID.fromString(json.readTree(response.getContentAsString()).get("correlationId").asString()));
        }
        var allowed = mvc.perform(options("/api/v1/auth/login").header("Origin", ORIGIN)
                .header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", "Content-Type,X-CSRF-Token")).andReturn().getResponse();
        assertEquals(200, allowed.getStatus());
        assertEquals(ORIGIN, allowed.getHeader("Access-Control-Allow-Origin"));
        assertEquals("true", allowed.getHeader("Access-Control-Allow-Credentials"));
    }
}

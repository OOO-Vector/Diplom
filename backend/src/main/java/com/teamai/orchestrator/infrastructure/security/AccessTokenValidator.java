package com.teamai.orchestrator.infrastructure.security;

import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.jwt.Jwt;
import java.time.*;
import java.util.UUID;

/** Required claims and strict time boundaries, in addition to Nimbus signature/algorithm checks. */
public final class AccessTokenValidator implements OAuth2TokenValidator<Jwt> {
    private final Clock clock;
    private final String issuer, audience, keyId;
    public AccessTokenValidator(Clock clock, String issuer, String audience, String keyId) {
        if (issuer.isBlank() || audience.isBlank() || keyId.isBlank()) throw new IllegalArgumentException("JWT configuration is required");
        this.clock = clock; this.issuer = issuer; this.audience = audience; this.keyId = keyId;
    }
    public OAuth2TokenValidatorResult validate(Jwt token) {
        try {
            if (!UUID.fromString(token.getSubject()).toString().equals(token.getSubject())
                    || !UUID.fromString(token.getId()).toString().equals(token.getId())) return invalid();
            Instant now = clock.instant(), issued = token.getIssuedAt(), expires = token.getExpiresAt();
            if (!issuer.equals(token.getClaimAsString("iss")) || token.getAudience() == null
                    || !token.getAudience().contains(audience) || !keyId.equals(token.getHeaders().get("kid"))
                    || issued == null || expires == null || issued.isAfter(now) || !expires.isAfter(now)
                    || !expires.isAfter(issued) || Duration.between(issued, expires).compareTo(Duration.ofSeconds(900)) > 0
                    || (token.getNotBefore() != null && token.getNotBefore().isAfter(now))) return invalid();
            return OAuth2TokenValidatorResult.success();
        } catch (RuntimeException invalidClaims) { return invalid(); }
    }
    private OAuth2TokenValidatorResult invalid() {
        return OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token"));
    }
}

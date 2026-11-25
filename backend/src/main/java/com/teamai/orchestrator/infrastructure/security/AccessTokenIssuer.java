package com.teamai.orchestrator.infrastructure.security;

import com.nimbusds.jose.jwk.RSAKey;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.stereotype.Component;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

@Component
public class AccessTokenIssuer {
    private final JwtEncoder encoder;
    private final Clock clock;
    private final String issuer, audience, keyId;
    public AccessTokenIssuer(JwtEncoder encoder, Clock clock, RSAKey key,
                             @Value("${app.security.jwt.issuer}") String issuer,
                             @Value("${app.security.jwt.audience}") String audience) {
        this.encoder = encoder; this.clock = clock; this.issuer = issuer; this.audience = audience; this.keyId = key.getKeyID();
    }
    public String issue(UUID userId) {
        var now = clock.instant().truncatedTo(ChronoUnit.SECONDS);
        var claims = JwtClaimsSet.builder().subject(userId.toString()).id(UUID.randomUUID().toString())
                .issuer(issuer).audience(List.of(audience)).issuedAt(now).expiresAt(now.plusSeconds(900)).build();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).keyId(keyId).build(), claims)).getTokenValue();
    }
}

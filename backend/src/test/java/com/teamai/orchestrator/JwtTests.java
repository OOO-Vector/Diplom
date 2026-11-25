package com.teamai.orchestrator;

import com.nimbusds.jose.jwk.*;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.teamai.orchestrator.infrastructure.security.*;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import java.security.*;
import java.security.interfaces.RSAPublicKey;
import java.security.interfaces.RSAPrivateKey;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class JwtTests {
    static final Instant NOW = Instant.parse("2026-11-23T12:00:00Z");
    static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
    static final String ISSUER = "https://issuer.example.test", AUDIENCE = "team-ai-api", KID = "ephemeral";
    static RSAKey key() throws Exception {
        var generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(2048);
        var pair = generator.generateKeyPair();
        return new RSAKey.Builder((RSAPublicKey)pair.getPublic()).privateKey((RSAPrivateKey)pair.getPrivate()).keyID(KID).build();
    }
    static JwtClaimsSet.Builder claims() {
        return JwtClaimsSet.builder().issuer(ISSUER).audience(List.of(AUDIENCE)).subject(UUID.randomUUID().toString())
                .id(UUID.randomUUID().toString()).issuedAt(NOW).expiresAt(NOW.plusSeconds(900));
    }
    static String sign(RSAKey key, SignatureAlgorithm algorithm, String kid, JwtClaimsSet claims) {
        var encoder = new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(key)));
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(algorithm).keyId(kid).build(), claims)).getTokenValue();
    }
    static org.springframework.core.io.Resource pem(String type, byte[] bytes) {
        return new org.springframework.core.io.ByteArrayResource(("-----BEGIN " + type + "-----\n"
                + Base64.getMimeEncoder(64, new byte[]{10}).encodeToString(bytes) + "\n-----END " + type + "-----\n")
                .getBytes(java.nio.charset.StandardCharsets.US_ASCII));
    }
    @Test void rejectsWeakMismatchedAndMalformedKeyConfiguration() throws Exception {
        var configuration = new JwtConfiguration(); var key = key(); var other = key();
        var privateKey = pem("PRIVATE KEY", key.toRSAPrivateKey().getEncoded());
        var publicKey = pem("PUBLIC KEY", key.toRSAPublicKey().getEncoded());
        assertNotNull(configuration.signingKey(privateKey, publicKey, KID));
        assertThrows(Exception.class, () -> configuration.signingKey(privateKey, pem("PUBLIC KEY", other.toRSAPublicKey().getEncoded()), KID));
        assertThrows(Exception.class, () -> configuration.signingKey(privateKey, publicKey, " "));
        var generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(1024); var weak = generator.generateKeyPair();
        assertThrows(Exception.class, () -> configuration.signingKey(pem("PRIVATE KEY", weak.getPrivate().getEncoded()), pem("PUBLIC KEY", weak.getPublic().getEncoded()), KID));
        assertThrows(Exception.class, () -> configuration.signingKey(new org.springframework.core.io.ByteArrayResource(new byte[0]), publicKey, KID));
    }
    @Test void productionSignerAndDecoderUseInjectedClock() throws Exception {
        var key = key(); var config = new JwtConfiguration();
        var issuer = new AccessTokenIssuer(config.jwtEncoder(key), CLOCK, key, ISSUER, AUDIENCE);
        var decoder = config.jwtDecoder(key, CLOCK, ISSUER, AUDIENCE);
        var id = UUID.randomUUID(); var token = decoder.decode(issuer.issue(id));
        assertEquals(id.toString(), token.getSubject()); assertEquals(NOW, token.getIssuedAt());
        assertEquals(NOW.plusSeconds(900), token.getExpiresAt());
        var expired = config.jwtDecoder(key, Clock.offset(CLOCK, Duration.ofSeconds(900)), ISSUER, AUDIENCE);
        assertThrows(JwtException.class, () -> expired.decode(token.getTokenValue()));
    }
    @Test void rejectsInvalidSignatureAlgorithmsAndMalformedTokens() throws Exception {
        var key = key(); var decoder = new JwtConfiguration().jwtDecoder(key, CLOCK, ISSUER, AUDIENCE);
        var wrongKey = key();
        for (String token : List.of(sign(wrongKey, SignatureAlgorithm.RS256, KID, claims().build()),
                sign(key, SignatureAlgorithm.RS512, KID, claims().build()), "not-a-jwt",
                "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.")) {
            assertThrows(JwtException.class, () -> decoder.decode(token));
        }
    }
    @Test void validatesAllRequiredClaimsAndStrictTimeBoundaries() throws Exception {
        var key = key(); var decoder = new JwtConfiguration().jwtDecoder(key, CLOCK, ISSUER, AUDIENCE);
        var invalid = new ArrayList<>(List.of(claims().issuer("https://wrong.example.test").build(),
                claims().audience(List.of("wrong")).build(), claims().subject("invalid").build(), claims().id("invalid").build(),
                claims().issuedAt(NOW.minusSeconds(900)).expiresAt(NOW).build(),
                claims().issuedAt(NOW.minusSeconds(901)).expiresAt(NOW.minusSeconds(1)).build(),
                claims().issuedAt(NOW.plusSeconds(1)).build(), claims().expiresAt(NOW.plusSeconds(901)).build(),
                claims().notBefore(NOW.plusSeconds(1)).build()));
        for (String name : List.of("sub", "jti", "iss", "aud", "iat", "exp")) invalid.add(claims().claims(map -> map.remove(name)).build());
        for (var claim : invalid) {
            String token = sign(key, SignatureAlgorithm.RS256, KID, claim);
            assertThrows(JwtException.class, () -> decoder.decode(token));
        }
        var unknownKid = new RSAKey.Builder(key).keyID("unknown").build();
        String token = sign(unknownKid, SignatureAlgorithm.RS256, "unknown", claims().build());
        assertThrows(JwtException.class, () -> decoder.decode(token));
        assertNotNull(decoder.decode(sign(key, SignatureAlgorithm.RS256, KID, claims().notBefore(NOW).build())));
    }
}

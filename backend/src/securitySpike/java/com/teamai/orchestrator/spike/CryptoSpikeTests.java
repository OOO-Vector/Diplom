package com.teamai.orchestrator.spike;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;

import static org.junit.jupiter.api.Assertions.*;

class CryptoSpikeTests {
    static final String ISSUER = "https://issuer.example.test";
    static final String AUDIENCE = "team-ai-api";
    static final Instant NOW = Instant.parse("2026-11-23T12:00:00Z");

    static KeyPair keyPair() throws Exception {
        var generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        return generator.generateKeyPair();
    }

    static String sign(KeyPair keys, SignatureAlgorithm algorithm, JwtClaimsSet claims) {
        var jwk = new RSAKey.Builder((RSAPublicKey) keys.getPublic())
                .privateKey((RSAPrivateKey) keys.getPrivate()).keyID("ephemeral-spike").build();
        var encoder = new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(jwk)));
        return encoder.encode(JwtEncoderParameters.from(
                JwsHeader.with(algorithm).keyId("ephemeral-spike").build(), claims)).getTokenValue();
    }

    static JwtClaimsSet.Builder claims() {
        return JwtClaimsSet.builder().issuer(ISSUER).audience(List.of(AUDIENCE))
                .subject(UUID.randomUUID().toString()).id(UUID.randomUUID().toString())
                .issuedAt(NOW).expiresAt(NOW.plusSeconds(900));
    }

    static NimbusJwtDecoder decoder(KeyPair keys) {
        var decoder = NimbusJwtDecoder.withPublicKey((RSAPublicKey) keys.getPublic())
                .signatureAlgorithm(SignatureAlgorithm.RS256).build();
        var time = new JwtTimestampValidator(Duration.ZERO);
        time.setClock(java.time.Clock.fixed(NOW, java.time.ZoneOffset.UTC));
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(time,
                new JwtIssuerValidator(ISSUER), new JwtClaimValidator<List<String>>("aud",
                audience -> audience != null && audience.contains(AUDIENCE)), jwt -> {
                    try {
                        UUID.fromString(jwt.getSubject());
                        UUID.fromString(jwt.getId());
                        if (jwt.getIssuedAt() == null || jwt.getExpiresAt() == null
                                || jwt.getIssuedAt().isAfter(NOW)
                                || !jwt.getExpiresAt().isAfter(NOW)
                                || !jwt.getExpiresAt().isAfter(jwt.getIssuedAt())
                                || Duration.between(jwt.getIssuedAt(), jwt.getExpiresAt()).compareTo(Duration.ofMinutes(15)) > 0) {
                            throw new IllegalArgumentException("Invalid lifetime");
                        }
                        return OAuth2TokenValidatorResult.success();
                    } catch (RuntimeException exception) {
                        return OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token"));
                    }
                }));
        return decoder;
    }

    @Test void argon2idUsesRequestedCostRandomSaltsAndExactPassword() {
        var encoder = new Argon2PasswordEncoder(16, 32, 1, 19 * 1024, 2);
        String password = " synthetic-test-password-🔐 ";
        long start = System.nanoTime();
        String hash = encoder.encode(password);
        assertTrue(hash.startsWith("$argon2id$v=19$m=19456,t=2,p=1$"));
        assertTrue(encoder.matches(password, hash));
        assertFalse(encoder.matches(password.trim(), hash));
        assertFalse(encoder.matches("wrong-synthetic-password", hash));
        assertNotEquals(hash, encoder.encode(password));
        System.out.println("Argon2 encode + 3 verifies + second encode, ms="
                + Duration.ofNanos(System.nanoTime() - start).toMillis());
    }

    @Test void rs256RoundTripAndRejectWrongSignatureOrAlgorithm() throws Exception {
        var keys = keyPair();
        var decoder = decoder(keys);
        assertEquals(AUDIENCE, decoder.decode(sign(keys, SignatureAlgorithm.RS256, claims().build())).getAudience().getFirst());
        assertThrows(JwtException.class, () -> decoder.decode(sign(keyPair(), SignatureAlgorithm.RS256, claims().build())));
        assertThrows(JwtException.class, () -> decoder.decode(sign(keys, SignatureAlgorithm.RS512, claims().build())));
        assertThrows(JwtException.class, () -> decoder.decode("eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0."));
        assertThrows(JwtException.class, () -> decoder.decode("not-a-jwt"));
    }

    @Test void rejectsWrongIssuerAudienceExpiryAndMissingIdentityClaims() throws Exception {
        var keys = keyPair();
        var decoder = decoder(keys);
        var invalid = List.of(
                claims().issuer("https://wrong.example.test").build(),
                claims().audience(List.of("other-api")).build(),
                claims().issuedAt(NOW.minusSeconds(900)).expiresAt(NOW).build(),
                claims().issuedAt(NOW.minusSeconds(1000)).expiresAt(NOW.minusSeconds(1)).build(),
                claims().issuedAt(NOW.plusSeconds(1)).build(),
                claims().expiresAt(NOW.plusSeconds(901)).build(),
                claims().subject("not-uuid").build(),
                claims().notBefore(NOW.plusSeconds(1)).build(),
                claims().claims(map -> map.remove("sub")).build(),
                claims().claims(map -> map.remove("aud")).build(),
                claims().claims(map -> map.remove("jti")).build(),
                claims().claims(map -> map.remove("exp")).build(),
                claims().claims(map -> map.remove("iat")).build());
        for (var claimSet : invalid) {
            String token = sign(keys, SignatureAlgorithm.RS256, claimSet);
            assertThrows(JwtException.class, () -> decoder.decode(token));
        }
    }
}

package com.teamai.orchestrator.infrastructure.security;

import com.nimbusds.jose.jwk.*;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.core.io.Resource;
import org.springframework.security.converter.RsaKeyConverters;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import java.time.Clock;

@Configuration
public class JwtConfiguration {
    @Bean public RSAKey signingKey(@Value("${app.security.jwt.private-key}") Resource privateKey,
                           @Value("${app.security.jwt.public-key}") Resource publicKey,
                           @Value("${app.security.jwt.key-id}") String keyId) throws Exception {
        try (var privateStream = privateKey.getInputStream(); var publicStream = publicKey.getInputStream()) {
            var secret = RsaKeyConverters.pkcs8().convert(privateStream);
            var trusted = RsaKeyConverters.x509().convert(publicStream);
            if (secret == null || trusted == null || trusted.getModulus().bitLength() < 2048
                    || !secret.getModulus().equals(trusted.getModulus()) || keyId.isBlank()) {
                throw new IllegalArgumentException("Configure matching RSA keys of at least 2048 bits and a key ID");
            }
            var probe = java.security.Signature.getInstance("SHA256withRSA");
            byte[] message = "team-ai-key-pair-check".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
            probe.initSign(secret); probe.update(message); byte[] signature = probe.sign();
            probe.initVerify(trusted); probe.update(message);
            if (!probe.verify(signature)) throw new IllegalArgumentException("RSA key pair verification failed");
            return new RSAKey.Builder(trusted).privateKey(secret).keyID(keyId).build();
        }
    }
    @Bean public JwtEncoder jwtEncoder(RSAKey key) { return new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(key))); }
    @Bean public JwtDecoder jwtDecoder(RSAKey key, Clock clock,
                               @Value("${app.security.jwt.issuer}") String issuer,
                               @Value("${app.security.jwt.audience}") String audience) throws Exception {
        var decoder = NimbusJwtDecoder.withPublicKey(key.toRSAPublicKey()).signatureAlgorithm(SignatureAlgorithm.RS256).build();
        decoder.setJwtValidator(new AccessTokenValidator(clock, issuer, audience, key.getKeyID()));
        return decoder;
    }
}

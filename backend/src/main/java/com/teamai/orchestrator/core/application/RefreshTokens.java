package com.teamai.orchestrator.core.application;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;

/** Canonical, unpadded base64url of exactly 32 random bytes; digest the wire credential as in CORE-03. */
public final class RefreshTokens {
    private static final SecureRandom RANDOM = new SecureRandom();
    private RefreshTokens() {}
    public static String generate() {
        byte[] bytes = new byte[32]; RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
    public static Optional<byte[]> digest(String credential) {
        if (credential == null || !credential.matches("[A-Za-z0-9_-]{43}")) return Optional.empty();
        byte[] decoded = Base64.getUrlDecoder().decode(credential);
        if (decoded.length != 32 || !Base64.getUrlEncoder().withoutPadding().encodeToString(decoded).equals(credential)) return Optional.empty();
        try { return Optional.of(MessageDigest.getInstance("SHA-256").digest(credential.getBytes(StandardCharsets.US_ASCII))); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException("SHA-256 unavailable", impossible); }
    }
}

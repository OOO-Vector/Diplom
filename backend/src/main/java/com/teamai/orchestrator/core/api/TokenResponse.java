package com.teamai.orchestrator.core.api;

public record TokenResponse(String accessToken, String tokenType, int expiresIn, UserResponse user) {
    @Override public String toString() { return "TokenResponse[redacted]"; }
}

package com.teamai.orchestrator.core.application;

/** Only fixed public messages belong here; never include SQL or client-provided values. */
public class CoreException extends RuntimeException {
    private final int status;
    private final String code;
    public CoreException(int status, String code, String message) { super(message); this.status = status; this.code = code; }
    public int status() { return status; }
    public String code() { return code; }
    public static CoreException invalid() { return new CoreException(400, "VALIDATION_ERROR", "Invalid request"); }
    public static CoreException missing() { return new CoreException(404, "PROJECT_NOT_FOUND", "Resource not found or not accessible"); }
    public static CoreException forbidden() { return new CoreException(403, "FORBIDDEN", "Action forbidden"); }
    public static CoreException archived() { return new CoreException(409, "PROJECT_ARCHIVED", "Project is archived"); }
}

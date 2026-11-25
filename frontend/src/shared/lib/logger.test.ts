import { afterEach, expect, it, vi } from "vitest";
import { logError } from "./logger";

afterEach(() => vi.restoreAllMocks());

it("logs a status and validated request and operation identifiers", () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  const context = {
    status: 503,
    correlationId: "req-9f8a7b6c",
    operationId: "550e8400-e29b-41d4-a716-446655440000",
  };
  logError("api.failure", context);
  expect(output).toHaveBeenCalledWith("api.failure", context);
});

it("drops untrusted fields and malformed identifiers", () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  const context = {
    status: "500",
    correlationId: "developer@example.invalid",
    operationId: "unstructured response text",
    detail: "private document content",
  };
  logError("api.failure", context);
  expect(output).toHaveBeenCalledWith("api.failure", {});
});

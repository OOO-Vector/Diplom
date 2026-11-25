import axios, { AxiosHeaders, type AxiosRequestConfig } from "axios";
import { z } from "zod";
import { httpClient } from "./httpClient";
import { parseProblemDetails } from "./problemDetails";

const messages: Record<number, string> = {
  400: "Check the information you entered.",
  401: "Authentication required. Please sign in.",
  403: "You do not have permission to perform this action.",
  404: "This resource could not be found.",
  409: "This action conflicts with the current state. Refresh and try again.",
  429: "Too many requests. Please wait before trying again.",
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly retryAt?: number,
    readonly fields: readonly string[] = [],
  ) {
    super(message);
  }
}

export function normalizeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (axios.isCancel(error))
    return new ApiError("Request cancelled.", undefined, "ABORTED");
  if (!axios.isAxiosError<unknown>(error))
    return new ApiError("Could not complete the request.");
  const status = error.response?.status;
  const problem = parseProblemDetails(error.response?.data);
  const retryAfter = AxiosHeaders.from(
    error.response?.headers as AxiosHeaders | undefined,
  ).get("retry-after");
  const retryAt =
    typeof retryAfter === "string"
      ? /^\d+$/.test(retryAfter)
        ? Date.now() + Number(retryAfter) * 1000
        : Date.parse(retryAfter)
      : NaN;
  const code = problem?.code ?? problem?.errorCode;
  const message =
    code === "CSRF_INVALID"
      ? "The security check expired. Please try again."
      : status
        ? (messages[status] ??
          (status >= 500
            ? "The service is temporarily unavailable."
            : "Could not complete the request."))
        : error.code === "ECONNABORTED" || error.code === "ETIMEDOUT"
          ? "The request timed out. Check your connection."
          : "Could not reach the server. Check your connection.";
  return new ApiError(
    message,
    status,
    code,
    Number.isFinite(retryAt) ? retryAt : undefined,
    problem?.fieldErrors?.map(({ field }) => field),
  );
}

export async function requestApi<S extends z.ZodType>(
  schema: S,
  config: AxiosRequestConfig,
): Promise<z.output<S>> {
  try {
    const response = await httpClient.request<unknown>(config);
    const parsed = schema.safeParse(
      response.status === 204 ? undefined : response.data,
    );
    if (!parsed.success)
      throw new ApiError("The server returned an unexpected response.");
    return parsed.data;
  } catch (error) {
    throw normalizeApiError(error);
  }
}

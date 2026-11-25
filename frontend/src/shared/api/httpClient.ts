import axios from "axios";
import { logError } from "../lib/logger";
import { parseProblemDetails } from "./problemDetails";

export const httpClient = axios.create({
  baseURL: "/api/v1",
  allowAbsoluteUrls: false,
  timeout: 15_000,
});

const listeners = new Set<() => void>();
let pendingRequests = 0;

export function subscribeToRequests(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPendingRequests() {
  return pendingRequests;
}

const adapter = axios.getAdapter(httpClient.defaults.adapter);
httpClient.defaults.adapter = async (config) => {
  pendingRequests += 1;
  listeners.forEach((listener) => listener());
  try {
    return await adapter(config);
  } finally {
    pendingRequests -= 1;
    listeners.forEach((listener) => listener());
  }
};

httpClient.interceptors.response.use(undefined, (error: unknown) => {
  if (axios.isAxiosError<unknown>(error) && !axios.isCancel(error)) {
    const problem = parseProblemDetails(error.response?.data);
    logError("api.failure", {
      status: error.response?.status,
      correlationId:
        problem?.correlationId ?? error.response?.headers["x-correlation-id"],
      operationId: problem?.operationId,
    });
  }
  return Promise.reject(error);
});

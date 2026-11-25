import { logError } from "../../../shared/lib/logger";

export async function verifyGitHubRepository(
  path: string,
  token: string,
  signal: AbortSignal,
) {
  if (!/^\/[\w.-]+\/[\w.-]+$/.test(path)) {
    throw new Error("Invalid GitHub repository path.");
  }

  try {
    const response = await fetch(`https://api.github.com/repos${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
      },
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) logError("api.failure", { status: response.status });
    return response;
  } catch (error) {
    if (!signal.aborted) logError("api.failure");
    throw error;
  }
}

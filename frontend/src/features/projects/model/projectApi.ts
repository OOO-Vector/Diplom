import { z } from "zod";
import { authSession } from "../../account/authSession";
import { ApiError } from "../../../shared/api/requestApi";

const projectId = z.string().uuid();
export const projectSchema = z.object({
  id: projectId,
  name: z.string(),
  description: z.string().nullable().optional(),
  myRole: z.enum(["owner", "member"]),
  status: z.enum(["active", "archived"]),
});
const pageSchema = z.object({
  items: z.array(projectSchema),
  totalPages: z.number().int().nonnegative(),
});

export async function listProjects(signal: AbortSignal) {
  const items: z.infer<typeof projectSchema>[] = [];
  for (let page = 0; ; page++) {
    const result = await authSession.request(pageSchema, {
      url: "/projects",
      params: { page },
      signal,
    });
    items.push(...result.items);
    if (page + 1 >= result.totalPages) return items;
  }
}

export function getProject(id: string, signal: AbortSignal) {
  if (!projectId.safeParse(id).success)
    return Promise.reject(
      new ApiError("This resource could not be found.", 404),
    );
  return authSession.request(projectSchema, { url: "/projects/" + id, signal });
}

export function createServerProject(name: string, signal: AbortSignal) {
  return authSession.request(projectSchema, {
    url: "/projects",
    method: "POST",
    data: { name },
    signal,
  });
}

export type Project = z.infer<typeof projectSchema>;

const memberSchema = z.object({
  userId: projectId,
  displayName: z.string(),
  role: z.enum(["owner", "member"]),
  joinedAt: z.string().datetime({ offset: true }),
});
const membersPage = z.object({
  items: z.array(memberSchema),
  totalPages: z.number().int().nonnegative(),
});
export type ProjectMember = z.infer<typeof memberSchema>;

function projectUrl(id: string) {
  return "/projects/" + encodeURIComponent(id);
}

export async function listMembers(id: string, signal: AbortSignal) {
  const items: ProjectMember[] = [];
  for (let page = 0; ; page++) {
    const result = await authSession.request(membersPage, {
      url: projectUrl(id) + "/members",
      params: { page },
      signal,
    });
    items.push(...result.items);
    if (page + 1 >= result.totalPages) return items;
  }
}

export function addMember(id: string, email: string, signal: AbortSignal) {
  return authSession.request(memberSchema, {
    url: projectUrl(id) + "/members",
    method: "POST",
    data: { email },
    signal,
  });
}

export function removeMember(id: string, userId: string, signal: AbortSignal) {
  return authSession.request(z.undefined(), {
    url: projectUrl(id) + "/members/" + encodeURIComponent(userId),
    method: "DELETE",
    signal,
  });
}

export function transferOwnership(
  id: string,
  newOwnerUserId: string,
  signal: AbortSignal,
) {
  return authSession.request(projectSchema, {
    url: projectUrl(id) + "/transfer-ownership",
    method: "POST",
    data: { newOwnerUserId },
    signal,
  });
}

export function archiveProject(id: string, signal: AbortSignal) {
  return authSession.request(projectSchema, {
    url: projectUrl(id) + "/archive",
    method: "POST",
    signal,
  });
}

export function updateProjectMetadata(
  id: string,
  data: { name: string; description: string | null },
  signal: AbortSignal,
) {
  return authSession.request(projectSchema, {
    url: projectUrl(id),
    method: "PATCH",
    data,
    signal,
  });
}

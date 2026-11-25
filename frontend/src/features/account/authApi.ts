import { z } from "zod";
import { requestApi } from "../../shared/api/requestApi";

const csrfSchema = z.object({
  headerName: z.literal("X-CSRF-Token"),
  token: z.string().min(1),
});
export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1),
  isActive: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
const sessionSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal("Bearer"),
  expiresIn: z.number().int().positive().max(86_400),
  user: userSchema.refine((user) => user.isActive),
});

function password(min: number) {
  return z
    .string()
    .refine(
      (value) =>
        [...value].length >= min &&
        [...value].length <= 128 &&
        new TextEncoder().encode(value).length <= 512,
      `Use ${min} to 128 characters (up to 512 UTF-8 bytes).`,
    );
}

export const loginSchema = z.object({
  email: z.string().trim().max(254).email("Enter a valid email address."),
  password: password(1),
});
export const registerSchema = loginSchema.extend({
  displayName: z.string().trim().min(1, "Enter your display name.").max(100),
  password: password(12),
});

function authPost<S extends z.ZodType>(
  path: string,
  schema: S,
  data?: unknown,
  signal?: AbortSignal,
) {
  const request = async () => {
    signal?.throwIfAborted();
    const csrf = await requestApi(csrfSchema, {
      url: "/auth/csrf",
      withCredentials: true,
      signal,
    });
    return requestApi(schema, {
      url: `/auth/${path}`,
      method: "POST",
      withCredentials: true,
      headers: { [csrf.headerName]: csrf.token },
      data,
      signal,
    });
  };
  return typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request("team-ai-auth-cookie", request)
    : request();
}

export const authApi = {
  register: (data: z.infer<typeof registerSchema>, signal?: AbortSignal) =>
    authPost("register", userSchema, data, signal),
  login: (data: z.infer<typeof loginSchema>, signal?: AbortSignal) =>
    authPost("login", sessionSchema, data, signal),
  refresh: () => authPost("refresh", sessionSchema),
  logout: () => authPost("logout", z.undefined()),
};

import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { Plugin } from "vite";

const credentials = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});
const registration = credentials.extend({
  displayName: z.string().trim().min(1).max(100),
});
const projectInput = z.object({ name: z.string().trim().min(1).max(150) });
const cookiePath = "/api/v1/auth";

function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=${cookiePath}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Secure`;
}

function token() {
  return randomBytes(32).toString("hex");
}

async function body(request: IncomingMessage): Promise<unknown> {
  let value = "";
  for await (const chunk of request) {
    value += String(chunk);
    if (Buffer.byteLength(value) > 8192) throw new Error("Request too large");
  }
  return value ? JSON.parse(value) : undefined;
}

export function authMock(): Plugin {
  const users = new Map<
    string,
    {
      user: {
        id: string;
        displayName: string;
        email: string;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
      };
      salt: string;
      hash: Buffer;
    }
  >();
  type User = NonNullable<ReturnType<typeof users.get>>["user"];
  const sessions = new Map<
    string,
    { user: User; family: string; expires: number }
  >();
  const access = new Map<
    string,
    { user: User; family: string; expires: number }
  >();
  const projects = new Map<
    string,
    {
      id: string;
      name: string;
      members: Map<
        string,
        { user: User; role: "owner" | "member"; joinedAt: string }
      >;
      status: "active" | "archived";
      createdBy: string;
      description: string | null;
      createdAt: string;
      updatedAt: string;
    }
  >();

  type MockProject = NonNullable<ReturnType<typeof projects.get>>;
  function projectResponse(project: MockProject, userId: string) {
    const { members, ...data } = project;
    return { ...data, myRole: members.get(userId)?.role };
  }
  function memberResponse(member: {
    user: User;
    role: "owner" | "member";
    joinedAt: string;
  }) {
    return {
      userId: member.user.id,
      displayName: member.user.displayName,
      role: member.role,
      joinedAt: member.joinedAt,
    };
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method;
    const cookies = Object.fromEntries(
      (req.headers.cookie ?? "").split(/;\s*/).map((entry) => entry.split("=")),
    );
    const send = (status: number, value?: unknown) => {
      res.statusCode = status;
      res.setHeader("Cache-Control", "no-store");
      if (value === undefined) return res.end();
      res.setHeader(
        "Content-Type",
        status >= 400 ? "application/problem+json" : "application/json",
      );
      return res.end(JSON.stringify(value));
    };
    const problem = (status: number, code: string) =>
      send(status, {
        type: "urn:team-ai:mock:" + code.toLowerCase(),
        title: code,
        status,
        code,
        correlationId: randomUUID(),
      });
    function issue(user: User, family: string = randomUUID()) {
      const refresh = token();
      const accessToken = token();
      sessions.set(refresh, {
        user,
        family,
        expires: Date.now() + 7 * 86_400_000,
      });
      access.set(accessToken, { user, family, expires: Date.now() + 900_000 });
      res.setHeader("Set-Cookie", cookie("mock_refresh", refresh, 7 * 86_400));
      return send(200, {
        user,
        accessToken,
        expiresIn: 900,
        tokenType: "Bearer",
      });
    }

    if (path === cookiePath + "/csrf" && method === "GET") {
      const csrf = token();
      res.setHeader("Set-Cookie", cookie("mock_csrf", csrf, 3600));
      return send(200, { headerName: "X-CSRF-Token", token: csrf });
    }
    if (path.startsWith(cookiePath + "/") && method === "POST") {
      const origin = "http://" + req.headers.host;
      if (
        req.headers.origin !== origin ||
        !cookies.mock_csrf ||
        req.headers["x-csrf-token"] !== cookies.mock_csrf
      )
        return problem(403, "CSRF_INVALID");
      const input = await body(req).catch(() => null);
      if (path === cookiePath + "/register") {
        const parsed = registration.safeParse(input);
        if (
          !parsed.success ||
          [...parsed.data.password].length < 12 ||
          [...parsed.data.password].length > 128
        )
          return problem(400, "VALIDATION_ERROR");
        const { displayName, password } = parsed.data;
        const email = parsed.data.email.toLowerCase();
        if (users.has(email)) return problem(409, "EMAIL_ALREADY_EXISTS");
        const now = new Date().toISOString();
        const user = {
          id: randomUUID(),
          displayName,
          email,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        };
        const salt = token();
        users.set(email, { user, salt, hash: scryptSync(password, salt, 64) });
        return send(201, user);
      }
      if (path === cookiePath + "/login") {
        const parsed = credentials.safeParse(input);
        if (!parsed.success) return problem(400, "VALIDATION_ERROR");
        const account = users.get(parsed.data.email.toLowerCase());
        if (
          !account ||
          !timingSafeEqual(
            account.hash,
            scryptSync(parsed.data.password, account.salt, 64),
          )
        )
          return problem(401, "INVALID_CREDENTIALS");
        return issue(account.user);
      }
      if (input !== undefined) return problem(400, "VALIDATION_ERROR");
      const refreshKey = cookies.mock_refresh ?? "";
      const refresh = sessions.get(refreshKey);
      if (path === cookiePath + "/refresh") {
        sessions.delete(refreshKey);
        if (refresh && refresh.expires > Date.now())
          return issue(refresh.user, refresh.family);
        res.setHeader("Set-Cookie", [
          cookie("mock_refresh", "", 0),
          cookie("mock_csrf", "", 0),
        ]);
        return problem(401, "REFRESH_INVALID");
      }
      if (path === cookiePath + "/logout") {
        if (refresh) {
          for (const [key, session] of sessions)
            if (session.family === refresh.family) sessions.delete(key);
          for (const [key, session] of access)
            if (session.family === refresh.family) access.delete(key);
        }
        res.setHeader("Set-Cookie", [
          cookie("mock_refresh", "", 0),
          cookie("mock_csrf", "", 0),
        ]);
        return send(204);
      }
    }
    const session = access.get(
      req.headers.authorization?.replace(/^Bearer /, "") ?? "",
    );
    if (!session || session.expires <= Date.now())
      return problem(401, "UNAUTHORIZED");
    if (path === "/api/v1/users/me" && method === "GET")
      return send(200, session.user);
    function page(items: readonly unknown[]) {
      const index = Number(url.searchParams.get("page") ?? 0);
      return {
        items: items.slice(index * 20, index * 20 + 20),
        page: index,
        size: 20,
        totalPages: Math.ceil(items.length / 20),
        totalElements: items.length,
      };
    }

    if (path === "/api/v1/projects" && method === "GET") {
      const items = [...projects.values()].filter((project) =>
        project.members.has(session.user.id),
      );
      return send(
        200,
        page(items.map((project) => projectResponse(project, session.user.id))),
      );
    }
    if (path === "/api/v1/projects" && method === "POST") {
      const parsed = projectInput.safeParse(await body(req).catch(() => null));
      if (!parsed.success) return problem(400, "VALIDATION_ERROR");
      const now = new Date().toISOString();
      const project: MockProject = {
        ...parsed.data,
        id: randomUUID(),
        description: null,
        createdBy: session.user.id,
        status: "active",
        members: new Map([
          [
            session.user.id,
            { user: session.user, role: "owner", joinedAt: now },
          ],
        ]),
        createdAt: now,
        updatedAt: now,
      };
      projects.set(project.id, project);
      res.setHeader("Location", "/api/v1/projects/" + project.id);
      return send(201, projectResponse(project, session.user.id));
    }
    const match =
      /^\/api\/v1\/projects\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(path);
    const project = projects.get(match?.[1] ?? "");
    const membership = project?.members.get(session.user.id);
    if (!project || !membership) return problem(404, "NOT_FOUND");
    const section = match?.[2];
    const memberId = match?.[3];
    if (method === "GET" && !section)
      return send(200, projectResponse(project, session.user.id));
    if (method === "GET" && section === "members" && !memberId)
      return send(200, page([...project.members.values()].map(memberResponse)));

    const payload =
      method === "POST" || method === "PATCH"
        ? await body(req).catch(() => null)
        : undefined;
    if (project.members.get(session.user.id)?.role !== "owner")
      return problem(403, "FORBIDDEN");
    if (method === "POST" && section === "archive" && !memberId) {
      project.status = "archived";
      project.updatedAt = new Date().toISOString();
      return send(200, projectResponse(project, session.user.id));
    }
    if (project.status === "archived") return problem(409, "PROJECT_ARCHIVED");

    if (method === "PATCH" && !section) {
      const parsed = projectInput
        .extend({ description: z.string().max(4000).nullable().optional() })
        .safeParse(payload);
      if (!parsed.success) return problem(400, "VALIDATION_ERROR");
      project.name = parsed.data.name;
      project.description = parsed.data.description ?? null;
      project.updatedAt = new Date().toISOString();
      return send(200, projectResponse(project, session.user.id));
    }
    if (method === "POST" && section === "members" && !memberId) {
      const parsed = z.object({ email: z.string().email() }).safeParse(payload);
      if (!parsed.success) return problem(400, "VALIDATION_ERROR");
      const account = users.get(parsed.data.email.toLowerCase());
      if (!account) return problem(404, "NOT_FOUND");
      if (project.members.has(account.user.id))
        return problem(409, "ALREADY_MEMBER");
      const next = {
        user: account.user,
        role: "member" as const,
        joinedAt: new Date().toISOString(),
      };
      project.members.set(account.user.id, next);
      return send(201, memberResponse(next));
    }
    if (method === "DELETE" && section === "members" && memberId) {
      const member = project.members.get(memberId);
      if (!member) return problem(404, "NOT_FOUND");
      if (member.role === "owner") return problem(409, "CANNOT_REMOVE_OWNER");
      project.members.delete(memberId);
      return send(204);
    }
    if (method === "POST" && section === "transfer-ownership" && !memberId) {
      const parsed = z
        .object({ newOwnerUserId: z.string().uuid() })
        .safeParse(payload);
      if (!parsed.success) return problem(400, "VALIDATION_ERROR");
      const next = project.members.get(parsed.data.newOwnerUserId);
      if (!next || next.role !== "member")
        return problem(409, "INVALID_NEW_OWNER");
      membership.role = "member";
      next.role = "owner";
      return send(200, projectResponse(project, session.user.id));
    }
    return problem(404, "NOT_FOUND");
  }

  return {
    name: "local-auth-mock",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/v1/")) return next();
        if (
          !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
            req.socket.remoteAddress ?? "",
          )
        ) {
          res.statusCode = 403;
          return res.end();
        }
        void handle(req, res).catch(() => {
          res.statusCode = 500;
          res.end();
        });
      });
    },
  };
}

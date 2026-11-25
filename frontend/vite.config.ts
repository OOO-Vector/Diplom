import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { authMock } from "./authMock";

export default defineConfig(({ command, isPreview, mode }) => {
  const env = loadEnv(mode, process.cwd(), "API_PROXY_");
  const backendDev =
    command === "serve" && !isPreview && mode === "development";
  const certificate = env.API_PROXY_TLS_CERT;
  const privateKey = env.API_PROXY_TLS_KEY;
  if (backendDev && (!certificate || !privateKey))
    throw new Error(
      "Set API_PROXY_TLS_CERT and API_PROXY_TLS_KEY for HTTPS backend development. See frontend/README.md.",
    );
  const target = new URL(env.API_PROXY_TARGET ?? "http://127.0.0.1:8080");
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
  ) {
    throw new Error(
      "API_PROXY_TARGET must be an HTTP(S) origin without credentials.",
    );
  }
  const proxy = {
    "/api": {
      target: target.origin,
      changeOrigin: true,
    },
  };

  return {
    plugins: [react(), ...(mode === "mock" ? [authMock()] : [])],
    server: {
      host: "127.0.0.1",
      strictPort: backendDev,
      https: backendDev
        ? { cert: readFileSync(certificate!), key: readFileSync(privateKey!) }
        : undefined,
      proxy: mode === "mock" || mode === "local-demo" ? undefined : proxy,
    },
    preview: { host: "127.0.0.1", proxy },
    test: {
      environment: "jsdom",
      setupFiles: ["./tests/setup.ts"],
      include: ["{src,tests}/**/*.test.{ts,tsx}"],
      coverage: {
        provider: "v8",
        all: true,
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts"],
        reporter: ["text", "html", "json-summary", "cobertura"],
        thresholds: { lines: 70 },
      },
    },
  };
});

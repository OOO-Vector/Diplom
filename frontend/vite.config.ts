import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { authMock } from "./authMock";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "API_PROXY_");
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
      proxy: mode === "mock" || mode === "local-demo" ? undefined : proxy,
    },
    preview: { host: "127.0.0.1", proxy },
    test: { environment: "jsdom" },
  };
});

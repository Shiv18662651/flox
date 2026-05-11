import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  plugins: [
    remix({
      ignoredRouteFiles: ["**/*.css", "**/*.test.ts", "**/*.test.tsx"],
    }),
  ],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./app"),
    },
  },
  server: {
    port: 3000,
  },
});

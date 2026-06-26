import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const host = process.env.TAURI_DEV_HOST;
const buildInfo = readFileSync(new URL("./webview/build-info.ts", import.meta.url), "utf8");
const assetTag = buildInfo.match(/WEB_BUILD_ID = "([^"]+)"/)?.[1].replace(/[^a-zA-Z0-9_-]/g, "_") ?? "dev";

export default defineConfig({
  clearScreen: false,
  publicDir: "webview/public",
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/target/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
    rollupOptions: {
      input: {
        main: "index.html",
        serverMap: "webview/server-map.ts",
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "serverMap" ? "assets/server-map.js" : `assets/[name]-[hash]-${assetTag}.js`,
        chunkFileNames: `assets/[name]-[hash]-${assetTag}.js`,
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith(".css")
            ? `assets/[name]-[hash]-${assetTag}[extname]`
            : "assets/[name]-[hash][extname]",
      },
    },
  },
});

import { defineConfig } from "vite";

// Tauri serves `dist/` in release builds; the dev server is only used by `tauri dev`.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { outDir: "dist", target: "es2022", sourcemap: false },
});

import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";

const wasmFile = "src/wasm-pkg/cipherchat_wasm_bg.wasm";
if (!existsSync(wasmFile)) {
  console.error(`Missing ${wasmFile}. Run \`npm run build:wasm\` first.`);
  process.exit(1);
}

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

const common = { bundle: true, target: "chrome110", sourcemap: false, logLevel: "info" };

await Promise.all([
  build({ ...common, entryPoints: ["src/background/index.ts"], outfile: "dist/background.js", format: "esm" }),
  build({ ...common, entryPoints: ["src/content/index.ts"], outfile: "dist/content.js", format: "iife" }),
  build({ ...common, entryPoints: ["src/popup/popup.ts"], outfile: "dist/popup.js", format: "iife" }),
]);

cpSync("public", "dist", { recursive: true });
cpSync("src/popup/popup.html", "dist/popup.html");
cpSync("src/popup/popup.css", "dist/popup.css");
cpSync(wasmFile, "dist/cipherchat_wasm_bg.wasm");
console.log("Built dist/ — load it via chrome://extensions → Load unpacked.");

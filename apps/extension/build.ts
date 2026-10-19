// Bundles the extension into dist/, ready to load unpacked in Chrome.
//
//   npm run extension            → apps/extension/dist
//
// Content scripts cannot be ES modules, so that one is bundled as a plain script; the worker and
// the popup are modules. Everything is bundled in: an extension may not load remote code.
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";

const dir = import.meta.dirname;
const outdir = join(dir, "dist");
const shared = { bundle: true, minify: true, target: "chrome120", logLevel: "info", legalComments: "none" } as const;

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({ ...shared, entryPoints: [join(dir, "src/content.ts")], outfile: join(outdir, "content.js"), format: "iife" });
await build({ ...shared, entryPoints: [join(dir, "src/background.ts"), join(dir, "src/popup.ts")], outdir, format: "esm", splitting: false });

for (const file of ["manifest.json", "src/popup.html"]) {
  await copyFile(join(dir, file), join(outdir, file.replace("src/", "")));
}
console.log(`Extension built: ${outdir}\nLoad it with chrome://extensions → Developer mode → Load unpacked.`);

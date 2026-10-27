import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { generateCatalog } from "./catalog.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const dist = path.join(root, "dist");
await generateCatalog();
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const name of [
  "index.html",
  "upload.html",
  "quiz.html",
  "login.html",
  "settings.html",
  "FIREBASE-SETUP.md",
  "firebase",
  "assets",
  "js",
  "quizzes",
  "examples",
])
  await cp(path.join(root, name), path.join(dist, name), { recursive: true });
await writeFile(
  path.join(dist, ".nojekyll"),
  "Static mathematics quiz website.\n",
);
console.log("Built dist/: static files ready for GitHub Pages.");

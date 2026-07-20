// Packs dist/firefox/ into dist/chrome-history-tab-manager-firefox.xpi so it
// can be installed permanently in Firefox Developer Edition (with
// xpinstall.signatures.required=false). Run after `npm run dev:firefox`.
//
// An .xpi is just a zip of the extension directory; symlinks are dereferenced
// (copied) so the package is self-contained.

import { cp, mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const outDir = path.join(distDir, "firefox");
const stagingDir = path.join(distDir, ".pack-staging");
const xpiPath = path.join(distDir, "chrome-history-tab-manager-firefox.xpi");

async function main() {
  // Resolve symlinks by copying into a staging tree, then zip that.
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  await cp(outDir, stagingDir, { recursive: true, verbatimSymlinks: false });

  await rm(xpiPath, { force: true });
  await execFileAsync("zip", ["-qr", xpiPath, "."], { cwd: stagingDir });
  await rm(stagingDir, { recursive: true, force: true });

  console.log(`packed → ${path.relative(root, xpiPath)}`);
  console.log(`Install permanently: Firefox Developer Edition → about:addons → gear → Install Add-on From File`);
}

main().catch((error) => {
  console.error(`pack-firefox failed: ${error.message}`);
  process.exit(1);
});

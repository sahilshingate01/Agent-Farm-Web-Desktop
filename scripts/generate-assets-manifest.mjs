#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const binaryExtensions = new Set([
  ".gif", ".ico", ".icns", ".jpeg", ".jpg", ".otf", ".png", ".svg",
  ".ttf", ".woff", ".woff2",
]);

function provenance(path) {
  if (/\.(?:woff2?|ttf|otf)$/i.test(path)) {
    return {
      author: path.includes("Geist")
        ? "Vercel and basement.studio"
        : "The named typeface authors, distributed by Fontsource",
      source: path.includes("/public/fonts/")
        ? "https://github.com/vercel/geist-font"
        : "https://fontsource.org/",
      license: "OFL-1.1",
    };
  }
  return {
    author: "Sahil Shingate",
    source: "Original project artwork contributed by Sahil Shingate",
    license: "AGPL-3.0-or-later",
  };
}

const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
}).split("\0").filter(Boolean);

const assets = tracked
  .filter((path) => binaryExtensions.has(extname(path).toLowerCase()))
  .map((path) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(join(root, path))).digest("hex"),
    ...provenance(path),
  }));

const manifest = {
  schemaVersion: 1,
  generatedBy: "scripts/generate-assets-manifest.mjs",
  assets,
};

writeFileSync(
  join(root, "ASSETS.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`Recorded ${assets.length} tracked assets.`);

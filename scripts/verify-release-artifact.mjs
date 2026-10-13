#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BINARY_ASSET_EXTENSIONS = new Set([
  ".gif", ".ico", ".icns", ".jpeg", ".jpg", ".otf", ".png", ".svg",
  ".ttf", ".woff", ".woff2",
]);

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export function verifyReleaseArtifact({ appPath, assetManifestPath }) {
  const frontend = join(
    appPath,
    "Contents",
    "Resources",
    "frontend",
    "dist",
  );
  const legal = join(frontend, "legal");
  const requiredLegal = [
    "AGPL-3.0.txt",
    "THIRD_PARTY_NOTICES.md",
    "NPM-DEPENDENCY-LICENSES.txt",
    "Native-SDK-Apache-2.0.txt",
    "OFL-1.1.txt",
  ];
  for (const name of requiredLegal) {
    const path = join(legal, name);
    if (!existsSync(path) || statSync(path).size === 0) {
      throw new Error(`Packaged legal file is missing or empty: ${name}`);
    }
  }
  const dependencyLicenses = readFileSync(
    join(legal, "NPM-DEPENDENCY-LICENSES.txt"),
    "utf8",
  );
  for (const license of ["Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause"]) {
    if (!dependencyLicenses.includes(license)) {
      throw new Error(`Packaged dependency license bundle has no ${license} entry.`);
    }
  }
  const approvedHashes = new Set(
    JSON.parse(readFileSync(assetManifestPath, "utf8")).assets
      .map((asset) => asset.sha256),
  );
  const unknown = walk(frontend)
    .filter((path) => BINARY_ASSET_EXTENSIONS.has(extname(path).toLowerCase()))
    .filter((path) => {
      const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
      return !approvedHashes.has(hash);
    });
  if (unknown.length) {
    throw new Error(
      `Packaged binary assets are absent from ASSETS.json by content hash: ${unknown.join(", ")}`,
    );
  }
  return {
    legalFiles: requiredLegal.length,
    binaryAssets: walk(frontend).filter((path) =>
      BINARY_ASSET_EXTENSIONS.has(extname(path).toLowerCase()),
    ).length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [appArgument, manifestArgument = "ASSETS.json"] = process.argv.slice(2);
  if (!appArgument) {
    throw new Error(
      "Usage: verify-release-artifact.mjs <path-to-app> [ASSETS.json]",
    );
  }
  const result = verifyReleaseArtifact({
    appPath: resolve(appArgument),
    assetManifestPath: resolve(manifestArgument),
  });
  console.log(
    `Artifact verified: ${result.legalFiles} legal files, ${result.binaryAssets} reviewed binary assets.`,
  );
}

#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i;

function packageName(lockPath, metadata) {
  if (metadata.name) return metadata.name;
  const marker = "node_modules/";
  const tail = lockPath.slice(lockPath.lastIndexOf(marker) + marker.length);
  const parts = tail.split("/");
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

/** Generate a deterministic bundle of exact license/notice files installed by
 * npm. The index lists every lockfile package, including packages whose npm
 * tarball omitted a standalone license file. */
export function generateNpmLicenseBundle({
  lockPath,
  packageRoot,
  outputPath,
}) {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const packages = [];
  const texts = new Map();
  for (const [relativePath, metadata] of Object.entries(lock.packages || {})) {
    if (!relativePath || !relativePath.includes("node_modules/")) continue;
    const directory = join(packageRoot, relativePath);
    let files = [];
    try {
      files = readdirSync(directory)
        .filter((name) => LICENSE_FILE.test(name))
        .filter((name) => statSync(join(directory, name)).isFile())
        .sort();
    } catch {
      files = [];
    }
    const textIds = [];
    for (const file of files) {
      const body = readFileSync(join(directory, file), "utf8").trim();
      if (!body) continue;
      const hash = createHash("sha256").update(body).digest("hex");
      if (!texts.has(hash)) texts.set(hash, { body, packages: [] });
      texts.get(hash).packages.push(
        `${packageName(relativePath, metadata)}@${metadata.version}`,
      );
      textIds.push(hash.slice(0, 16));
    }
    packages.push({
      name: packageName(relativePath, metadata),
      version: metadata.version || "unknown",
      license: metadata.license || "see DEPENDENCY_LICENSE_OVERRIDES.json",
      textIds,
    });
  }
  packages.sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  );
  const sections = [
    "NPM dependency licenses and notices",
    "",
    "Generated from desktop/frontend/package-lock.json and the exact npm install used for this build.",
    "",
    "PACKAGE INDEX",
    ...packages.map((entry) =>
      `${entry.name}@${entry.version} | ${entry.license} | ${
        entry.textIds.length ? entry.textIds.join(", ") : "no standalone file in npm package"
      }`,
    ),
    "",
    "EXACT INSTALLED LICENSE AND NOTICE TEXTS",
  ];
  for (const [hash, entry] of [...texts.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    sections.push(
      "",
      "=".repeat(78),
      `TEXT ${hash.slice(0, 16)}`,
      `USED BY: ${[...new Set(entry.packages)].sort().join(", ")}`,
      "=".repeat(78),
      entry.body,
    );
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${sections.join("\n")}\n`);
  return { packages: packages.length, uniqueTexts: texts.size };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [lockPath, packageRoot, outputPath] = process.argv.slice(2).map(resolve);
  if (!lockPath || !packageRoot || !outputPath) {
    throw new Error(
      "Usage: generate-npm-license-bundle.mjs <package-lock> <package-root> <output>",
    );
  }
  const result = generateNpmLicenseBundle({ lockPath, packageRoot, outputPath });
  console.log(
    `Wrote ${result.packages} package entries and ${result.uniqueTexts} unique license texts.`,
  );
}

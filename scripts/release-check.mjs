#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  containsProhibitedSourceIdentity,
  PRIVATE_PUBLICATION_FILES,
  PRIVATE_PUBLICATION_PATHS,
} from "./publication-policy.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const publicationMode = process.argv.includes("--publication");
const required = [
  "LICENSE",
  "ASSETS.json",
  "CONTRIBUTING.md",
  "DEPENDENCY_LICENSE_OVERRIDES.json",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
];
const assetExtensions = new Set([
  ".gif", ".ico", ".icns", ".jpeg", ".jpg", ".otf", ".png", ".svg",
  ".ttf", ".woff", ".woff2",
]);
const compatibleDependencyLicenses = new Set([
  "(AFL-2.1 OR BSD-3-Clause)",
  "(Apache-2.0 AND BSD-3-Clause)",
  "(MPL-2.0 OR Apache-2.0)",
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "ISC",
  "MIT",
  "MPL-2.0",
  "OFL-1.1",
  "Unlicense",
]);

function hasExecutableMagic(bytes) {
  if (bytes.length < 4) return false;
  const magic = bytes.subarray(0, 4).toString("hex");
  return new Set([
    "7f454c46", // ELF
    "cafebabe", "cafebabf", "bebafeca", // universal Mach-O
    "feedface", "feedfacf", "cefaedfe", "cffaedfe", // Mach-O
  ]).has(magic);
}

function fail(message) {
  failures.push(message);
}

function json(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  }).split("\0").filter(Boolean);
}

function publicationFiles() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  ).split("\0").filter(Boolean);
}

function publicationStatus() {
  return execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: root, encoding: "utf8" },
  ).trim().split(/\r?\n/).filter(Boolean);
}

function packageVersion() {
  const source = readFileSync(join(root, "desktop/app.zon"), "utf8");
  return /\.version\s*=\s*"([^"]+)"/.exec(source)?.[1] || null;
}

function packageNameFromLockPath(path) {
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  if (index === -1) return null;
  const segments = path.slice(index + marker.length).split("/");
  return segments[0]?.startsWith("@")
    ? `${segments[0]}/${segments[1]}`
    : segments[0];
}

for (const path of required) {
  if (!existsSync(join(root, path))) fail(`missing required publication file: ${path}`);
}

const version = packageVersion();
const frontend = json("desktop/frontend/package.json");
const daemon = json("daemon/package.json");
const runtimeVersion = json("desktop/frontend/public/version.json").version;
const dependencyOverrides = new Map(
  (json("DEPENDENCY_LICENSE_OVERRIDES.json").packages || [])
    .map((entry) => [`${entry.name}@${entry.version}`, entry]),
);
if (!version) fail("desktop/app.zon has no version");
for (const [name, pkg] of [["desktop frontend", frontend], ["daemon", daemon]]) {
  if (pkg.version !== version) {
    fail(`${name} version ${pkg.version} does not match app.zon ${version}`);
  }
  if (pkg.license !== "AGPL-3.0-or-later") {
    fail(`${name} license must be AGPL-3.0-or-later`);
  }
}
if (runtimeVersion !== version) {
  fail(`desktop runtime version ${runtimeVersion} does not match app.zon ${version}`);
}

const releaseTag = process.argv.slice(2).find((argument) => !argument.startsWith("--"))
  || process.env.GITHUB_REF_NAME
  || "";
if (releaseTag && releaseTag.replace(/^v/, "") !== version) {
  fail(`release tag ${releaseTag} does not match app version ${version}`);
}

const license = readFileSync(join(root, "LICENSE"), "utf8");
if (
  license.length < 30_000
  || !license.includes("GNU AFFERO GENERAL PUBLIC LICENSE")
  || !license.includes("13. Remote Network Interaction")
  || !license.includes("17. Interpretation of Sections 15 and 16.")
  || !license.includes("END OF TERMS AND CONDITIONS")
) {
  fail("root LICENSE is not the GNU Affero GPL text");
}

for (const [path, pkg] of [
  ["desktop/frontend/package.json", frontend],
  ["daemon/package.json", daemon],
]) {
  for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, specifier] of Object.entries(pkg[group] || {})) {
      if (!String(specifier).startsWith("file:")) continue;
      const target = resolve(dirname(join(root, path)), String(specifier).slice(5));
      const outside = relative(root, target).startsWith("..") || isAbsolute(relative(root, target));
      if (outside) fail(`${path}: ${name} resolves outside the repository`);
    }
  }
}

for (const lockPath of [
  "desktop/frontend/package-lock.json",
  "daemon/package-lock.json",
]) {
  const lock = json(lockPath);
  for (const [path, pkg] of Object.entries(lock.packages || {})) {
    if (!path) continue;
    const name = pkg.name || packageNameFromLockPath(path);
    const override = dependencyOverrides.get(`${name}@${pkg.version}`);
    if (override && !String(override.evidence || "").trim()) {
      fail(`${lockPath}: ${name}@${pkg.version} override has no evidence`);
    }
    const licenseId = pkg.license || override?.license;
    if (!licenseId) {
      fail(`${lockPath}: ${name}@${pkg.version} has no recorded license`);
    } else if (!compatibleDependencyLicenses.has(licenseId)) {
      fail(`${lockPath}: ${name}@${pkg.version} has unreviewed license ${licenseId}`);
    }
  }
}

const viteConfig = readFileSync(join(root, "desktop/frontend/vite.config.js"), "utf8");
if (/\/Users\/[^/]+|[A-Z]:\\Users\\/i.test(viteConfig)) {
  fail("vite.config.js contains a personal absolute path");
}

if (existsSync(join(root, "ASSETS.json"))) {
  const manifest = json("ASSETS.json");
  const manifestPaths = new Set((manifest.assets || []).map((asset) => asset.path));
  for (const path of trackedFiles().filter((path) => assetExtensions.has(extname(path).toLowerCase()))) {
    if (!manifestPaths.has(path)) fail(`tracked asset is missing from ASSETS.json: ${path}`);
  }
  for (const asset of manifest.assets || []) {
    const path = join(root, asset.path);
    if (!existsSync(path)) {
      fail(`asset manifest path is missing: ${asset.path}`);
      continue;
    }
    const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (sha !== asset.sha256) fail(`asset hash is stale: ${asset.path}`);
    if (!asset.author || !asset.source || !asset.license) {
      fail(`asset provenance is incomplete: ${asset.path}`);
    }
    if (
      publicationMode
      && [asset.author, asset.source, asset.license]
        .some((value) => /confirmation required|subject to ownership confirmation/i.test(String(value)))
    ) {
      fail(`asset ownership is not cleared for publication: ${asset.path}`);
    }
  }
}

if (publicationMode) {
  const tracked = publicationFiles();
  const dirty = publicationStatus();
  if (dirty.length) {
    fail(`publication requires a clean Git tree; ${dirty.length} path(s) differ from HEAD, including: ${dirty.slice(0, 5).join(", ")}`);
  }
  if (
    tracked.length < 100
    || !tracked.includes("desktop/frontend/public/backend/gateway.mjs")
    || !tracked.includes("daemon/src/farmd.mjs")
  ) {
    fail("publication scan was vacuous: expected desktop and daemon sources were not enumerated");
  }
  for (const prefix of PRIVATE_PUBLICATION_PATHS) {
    if (tracked.some((path) => path.startsWith(prefix))) {
      fail(`private development surface must be removed from the public snapshot: ${prefix}`);
    }
  }
  for (const path of PRIVATE_PUBLICATION_FILES) {
    if (tracked.includes(path)) {
      fail(`private development file must be removed from the public snapshot: ${path}`);
    }
  }
  const personalPathFiles = [];
  const sourceIdentityFiles = [];
  const brokenMarkdownLinks = [];
  for (const path of tracked) {
    if (
      path === "scripts/release-check.mjs"
      || path === "scripts/publication-policy.mjs"
    ) continue;
    let bytes;
    try {
      bytes = readFileSync(join(root, path));
    } catch {
      continue;
    }
    if (bytes.includes(0)) {
      if (
        !assetExtensions.has(extname(path).toLowerCase())
        && !hasExecutableMagic(bytes)
      ) {
        fail(`source-like file contains a NUL byte and was not scanned: ${path}`);
      }
      continue;
    }
    const text = bytes.toString("utf8");
    if (/\/Users\/[A-Za-z0-9._-]+\//.test(text)) {
      personalPathFiles.push(path);
    }
    if (
      containsProhibitedSourceIdentity(path)
      || containsProhibitedSourceIdentity(text)
    ) {
      sourceIdentityFiles.push(path);
    }
    if (extname(path).toLowerCase() === ".md") {
      for (const match of text.matchAll(/\[[^\]]*]\(([^)]+)\)/g)) {
        const raw = match[1].trim().replace(/^<|>$/g, "");
        const target = raw.split(/\s+["']/)[0].split("#")[0];
        if (
          !target
          || /^(?:[a-z]+:|#|\/)/i.test(target)
          || existsSync(resolve(dirname(join(root, path)), target))
        ) continue;
        brokenMarkdownLinks.push(`${path} -> ${target}`);
      }
    }
  }
  if (personalPathFiles.length) {
    fail(`personal absolute paths remain in ${personalPathFiles.length} tracked file(s), including: ${personalPathFiles.slice(0, 5).join(", ")}`);
  }
  if (sourceIdentityFiles.length) {
    fail(`source-product identities remain in ${sourceIdentityFiles.length} tracked file(s), including: ${sourceIdentityFiles.slice(0, 5).join(", ")}`);
  }
  if (brokenMarkdownLinks.length) {
    fail(`broken internal Markdown links remain (${brokenMarkdownLinks.length}), including: ${brokenMarkdownLinks.slice(0, 5).join(", ")}`);
  }
}

if (failures.length) {
  console.error(`${publicationMode ? "Publication" : "Release"} readiness failed:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`${publicationMode ? "Publication" : "Release"} readiness passed for ${version}.`);

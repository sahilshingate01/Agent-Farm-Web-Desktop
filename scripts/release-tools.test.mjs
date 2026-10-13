import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateNpmLicenseBundle } from "./generate-npm-license-bundle.mjs";
import { verifyReleaseArtifact } from "./verify-release-artifact.mjs";
import { containsProhibitedSourceIdentity } from "./publication-policy.mjs";

test("publication identity matching covers paths and identifiers without flagging shell.openPath", () => {
  for (const value of [
    "BU" + "ZZ",
    "cLu" + "SoWidgetMount",
    "src/Tiny" + "WorldClient.ts",
    "almost" + "node-adapter",
  ]) {
    assert.equal(containsProhibitedSourceIdentity(value), true, value);
  }
  assert.equal(
    containsProhibitedSourceIdentity("dispatch with shell.openPath after validation"),
    false,
  );
});

test("npm license bundle includes package index and exact installed text", () => {
  const root = mkdtempSync(join(tmpdir(), "farm-release-tools-"));
  const packageDirectory = join(root, "node_modules", "example");
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(join(packageDirectory, "LICENSE"), "Exact MIT license text\n");
  const lockPath = join(root, "package-lock.json");
  writeFileSync(lockPath, JSON.stringify({
    packages: {
      "": { name: "fixture" },
      "node_modules/example": {
        name: "example",
        version: "1.2.3",
        license: "MIT",
      },
    },
  }));
  const outputPath = join(root, "licenses.txt");
  const result = generateNpmLicenseBundle({
    lockPath,
    packageRoot: root,
    outputPath,
  });
  assert.deepEqual(result, { packages: 1, uniqueTexts: 1 });
  const body = readFileSync(outputPath, "utf8");
  assert.match(body, /example@1\.2\.3 \| MIT/);
  assert.match(body, /Exact MIT license text/);
});

test("artifact verifier checks legal payload and binary asset provenance", () => {
  const root = mkdtempSync(join(tmpdir(), "farm-release-artifact-"));
  const app = join(root, "Farm.app");
  const frontend = join(
    app,
    "Contents",
    "Resources",
    "frontend",
    "dist",
  );
  const legal = join(frontend, "legal");
  mkdirSync(join(frontend, "assets"), { recursive: true });
  mkdirSync(legal, { recursive: true });
  for (const name of [
    "AGPL-3.0.txt",
    "THIRD_PARTY_NOTICES.md",
    "Native-SDK-Apache-2.0.txt",
    "OFL-1.1.txt",
  ]) {
    writeFileSync(join(legal, name), `${name}\n`);
  }
  writeFileSync(
    join(legal, "NPM-DEPENDENCY-LICENSES.txt"),
    "Apache-2.0 MIT BSD-2-Clause BSD-3-Clause\n",
  );
  const asset = Buffer.from("reviewed image");
  writeFileSync(join(frontend, "assets", "icon.png"), asset);
  const manifest = join(root, "ASSETS.json");
  writeFileSync(manifest, JSON.stringify({
    assets: [{
      path: "source/icon.png",
      sha256: createHash("sha256").update(asset).digest("hex"),
    }],
  }));
  assert.deepEqual(
    verifyReleaseArtifact({ appPath: app, assetManifestPath: manifest }),
    { legalFiles: 5, binaryAssets: 1 },
  );

  writeFileSync(join(frontend, "assets", "unreviewed.png"), "unknown");
  assert.throws(
    () => verifyReleaseArtifact({ appPath: app, assetManifestPath: manifest }),
    /absent from ASSETS.json/,
  );
});

#!/usr/bin/env node

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const [sdkArgument, outputArgument] = process.argv.slice(2);
if (!sdkArgument || !outputArgument) {
  throw new Error(
    "Usage: copy-native-sdk-license.mjs <native-sdk-root> <output-file>",
  );
}
const source = join(resolve(sdkArgument), "LICENSE");
const body = readFileSync(source, "utf8");
if (!body.includes("Apache License") || !body.includes("Version 2.0")) {
  throw new Error(`Native SDK license is not the expected Apache-2.0 text: ${source}`);
}
const output = resolve(outputArgument);
mkdirSync(dirname(output), { recursive: true });
copyFileSync(source, output);

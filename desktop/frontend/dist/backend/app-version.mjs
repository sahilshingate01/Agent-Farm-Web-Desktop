import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const SOURCE_URL = "https://github.com/sahilshingate01/Agent-Farm-Web-Desktop";

/** Read the frontend version file that Vite copies beside the bundled backend.
 * The release gate keeps it in lockstep with app.zon and both package files. */
export function appVersion() {
  try {
    const value = JSON.parse(readFileSync(join(here, "..", "version.json"), "utf8"));
    if (typeof value.version === "string" && value.version.trim()) {
      return value.version.trim();
    }
  } catch {
    // A missing version file is caught by release-check; runtime stays honest.
  }
  return "0.0.0-dev";
}

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAliasManifest, validateManifestInvariants, type AliasManifest } from "@farejo/shared";

const DEFAULT_MANIFEST_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../curation/aliases-manifest.json");

export async function loadAliasManifest(path: string = DEFAULT_MANIFEST_PATH): Promise<AliasManifest> {
  const raw = await readFile(path, "utf8");
  const manifest = parseAliasManifest(JSON.parse(raw));

  const violations = validateManifestInvariants(manifest);
  if (violations.length > 0) {
    throw new Error(`Manifesto de aliases inválido (${path}): ${JSON.stringify(violations)}`);
  }

  return manifest;
}

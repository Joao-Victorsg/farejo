import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Resolve o caminho absoluto de uma fixture integral (histórico do `--live`, ver docs/poc/README.md). */
export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

export function loadFixture(name: string): string {
  return readFileSync(fixturePath(name), "utf8");
}

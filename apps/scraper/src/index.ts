import type { PlatformAdapter } from "@farejo/shared";
import { interAdapter } from "./inter.js";
import { mycashbackAdapter } from "./mycashback.js";

export const adapters: PlatformAdapter[] = [interAdapter, mycashbackAdapter];

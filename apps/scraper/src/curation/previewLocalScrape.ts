import { createClient } from "@farejo/shared";
import { interAdapter } from "../inter.js";
import { LOCAL_SERVICE_ROLE_KEY, LOCAL_URL } from "../localDb.js";
import { mycashbackAdapter } from "../mycashback.js";
import { runAllPlatforms } from "../runner.js";
import { zoomAdapter } from "../zoom.js";

const results = await runAllPlatforms(
  createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY),
  [interAdapter, mycashbackAdapter, zoomAdapter],
);
for (const result of results) console.log(result);
if (results.some((result) => result.status !== "ok")) process.exitCode = 1;

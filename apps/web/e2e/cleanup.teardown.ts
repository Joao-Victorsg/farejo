import { test } from "@playwright/test";
import { cleanFixtures, withDb } from "./db";

test("remove F3/T17 fixtures", async () => {
  await withDb(cleanFixtures);
});

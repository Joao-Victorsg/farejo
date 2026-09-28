import "server-only";
import type { Pool } from "pg";
import { z } from "zod";
import { createPostgresPool } from "@farejo/postgres";

let feedbackPool: Pool | undefined;

function getFeedbackPool() {
  if (feedbackPool) return feedbackPool;
  const connectionString = z.string().url().parse(process.env.FAREJO_FEEDBACK_DATABASE_URL);
  feedbackPool = createPostgresPool(connectionString, {
    max: 1,
    connectionTimeoutMillis: 1_500,
    query_timeout: 1_500,
  });
  return feedbackPool;
}

export async function reportOfferDiscrepancy(storeSlug: string, platformId: string): Promise<boolean> {
  const result = await getFeedbackPool().query(
    "select feedback.report_offer_discrepancy($1, $2) as accepted",
    [storeSlug, platformId],
  );
  return z.object({ accepted: z.boolean() }).parse(result.rows[0]).accepted;
}

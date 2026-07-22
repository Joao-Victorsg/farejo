import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Client } from "pg";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { normalizeLogoImage } from "./image.js";
import { ingestLogos, processStore, selectCandidateStores, type LogoWriterPool } from "./ingest.js";
import { UnsafeUrlError, type SafeFetchOptions } from "./net.js";
import { createLogoStorage } from "./storage.js";

/**
 * F3/T15 (#61, ADR-0014/ADR-0038/ADR-0042) — entrypoint real de ponta a ponta: Postgres e
 * Storage locais (`supabase start`), servidor HTTP local fazendo o papel das plataformas de
 * origem. `fetchOptions` troca só a fonte de confiança do endereço (mesmo padrão de
 * `net.test.ts`) para poder exercitar o fluxo completo sem certificado HTTPS real; a validação
 * de IP/protocolo em si já está coberta isoladamente em `net.test.ts`.
 */
type SupabaseStatus = {
  DB_URL: string;
  API_URL: string;
  STORAGE_S3_URL: string;
  S3_PROTOCOL_ACCESS_KEY_ID: string;
  S3_PROTOCOL_ACCESS_KEY_SECRET: string;
  S3_PROTOCOL_REGION: string;
};

const status: SupabaseStatus = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf-8" }));

const adminClient = new Client({ connectionString: status.DB_URL });
const writerClient = new Client({ connectionString: status.DB_URL });
const s3 = new S3Client({
  endpoint: status.STORAGE_S3_URL,
  region: status.S3_PROTOCOL_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: status.S3_PROTOCOL_ACCESS_KEY_ID, secretAccessKey: status.S3_PROTOCOL_ACCESS_KEY_SECRET },
});
const storage = createLogoStorage({
  FAREJO_LOGO_S3_ENDPOINT: status.STORAGE_S3_URL,
  FAREJO_LOGO_S3_ACCESS_KEY_ID: status.S3_PROTOCOL_ACCESS_KEY_ID,
  FAREJO_LOGO_S3_SECRET_ACCESS_KEY: status.S3_PROTOCOL_ACCESS_KEY_SECRET,
  FAREJO_LOGO_S3_REGION: status.S3_PROTOCOL_REGION,
  FAREJO_LOGO_PUBLIC_BASE_URL: `${status.API_URL}/storage/v1/object/public/store-logos`,
});

const fixturePrefix = "issue61-logos-";
const uploadedKeys: string[] = [];

// writerClient roda TUDO sob `farejo_logo_writer` (T14) — prova que o entrypoint real
// funciona só com os grants dessa role, nunca `service_role`.
const writerPool: LogoWriterPool = writerClient;

function poolThatFailsPointerUpdate(pool: LogoWriterPool): LogoWriterPool {
  return {
    async query(text: string, params?: unknown[]) {
      if (/^\s*update\s+stores\s+set\s+logo_url/i.test(text)) {
        throw new Error("simulated failure updating the stores pointer");
      }
      return pool.query(text, params);
    },
  };
}

async function insertStore(suffix: string): Promise<number> {
  const slug = `${fixturePrefix}${suffix}`;
  const { rows } = await adminClient.query<{ id: number }>("insert into public.stores (slug, name) values ($1, $2) returning id", [
    slug,
    slug,
  ]);
  return rows[0]!.id;
}

async function insertSource(storeId: number, platformId: string, url: string): Promise<void> {
  await adminClient.query(
    "insert into public.store_logo_sources (store_id, platform_id, url, last_seen_at) values ($1, $2, $3, now())",
    [storeId, platformId, url],
  );
}

async function fetchStore(storeId: number) {
  const { rows } = await adminClient.query<{ logo_url: string | null; logo_hash: string | null }>(
    "select logo_url, logo_hash from public.stores where id = $1",
    [storeId],
  );
  return rows[0]!;
}

async function fetchSource(storeId: number, platformId: string) {
  const { rows } = await adminClient.query(
    "select verified_url, verified_status, rejection_reason, content_hash, width, height, verified_at from public.store_logo_sources where store_id = $1 and platform_id = $2",
    [storeId, platformId],
  );
  return rows[0];
}

async function objectExists(key: string): Promise<boolean> {
  const response = await fetch(`${status.API_URL}/storage/v1/object/public/store-logos/${key}`);
  return response.status === 200;
}

function trackUploads(key: string) {
  uploadedKeys.push(key);
}

async function cleanFixtures() {
  await Promise.all(uploadedKeys.map((key) => s3.send(new DeleteObjectCommand({ Bucket: "store-logos", Key: key })).catch(() => {})));
  uploadedKeys.length = 0;
  await adminClient.query("delete from public.store_logo_sources where store_id in (select id from public.stores where slug like $1)", [
    `${fixturePrefix}%`,
  ]);
  await adminClient.query("delete from public.stores where slug like $1", [`${fixturePrefix}%`]);
}

describe("logo ingestion entrypoint (Postgres+Storage local, F3/T15/#61)", () => {
  let server: Server;
  let baseUrl: string;
  let fetchOptions: SafeFetchOptions;
  let squareBig: Buffer;
  let squareSmall: Buffer;
  let banner: Buffer;
  let squareBigAsPng: Buffer;

  beforeAll(async () => {
    await adminClient.connect();
    await writerClient.connect();
    await writerClient.query("set role farejo_logo_writer");
    await cleanFixtures();

    squareBig = await sharp({ create: { width: 150, height: 150, channels: 3, background: { r: 10, g: 120, b: 200 } } }).webp().toBuffer();
    squareSmall = await sharp({ create: { width: 90, height: 90, channels: 3, background: { r: 200, g: 30, b: 30 } } }).webp().toBuffer();
    banner = await sharp({ create: { width: 250, height: 80, channels: 3, background: { r: 0, g: 0, b: 0 } } }).jpeg().toBuffer();
    squareBigAsPng = await sharp(squareBig).png().toBuffer(); // mesmos pixels do squareBig, container diferente

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/square-big.webp") return void res.writeHead(200, { "content-type": "image/webp" }).end(squareBig);
      if (url.pathname === "/square-big.png") return void res.writeHead(200, { "content-type": "image/png" }).end(squareBigAsPng);
      if (url.pathname === "/square-small.webp") return void res.writeHead(200, { "content-type": "image/webp" }).end(squareSmall);
      if (url.pathname === "/banner.jpg") return void res.writeHead(200, { "content-type": "image/jpeg" }).end(banner);
      if (url.pathname === "/invalid") return void res.writeHead(200, { "content-type": "text/html" }).end("<html>not an image</html>");
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    // Host por NOME, nunca IP literal — com IP literal o Node conecta direto e o `lookup`
    // fixado do agent nunca roda, escondendo regressões no caminho de rede real (ADR-0057).
    const testHost = "logo-cdn.test";
    baseUrl = `http://${testHost}:${(server.address() as AddressInfo).port}`;

    fetchOptions = {
      allowedProtocols: ["http:"],
      resolveAddress: async (hostname) => {
        if (hostname === testHost) return [{ address: "127.0.0.1", family: 4 as const }];
        throw new UnsafeUrlError(`endereço não confiável no cenário de teste: ${hostname}`);
      },
    };
  });

  afterAll(async () => {
    await cleanFixtures();
    await adminClient.end();
    await writerClient.query("reset role");
    await writerClient.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(async () => {
    await cleanFixtures();
  });

  it("selects a store without a final logo, and skips one whose logo and sources are already verified and unchanged", async () => {
    const withoutLogo = await insertStore("no-logo");
    await insertSource(withoutLogo, "zoom", `${baseUrl}/square-big.webp`);

    const alreadyDone = await insertStore("already-done");
    await insertSource(alreadyDone, "zoom", `${baseUrl}/square-big.webp`);
    // Simula "já processada": verified_url == url, logo_hash já preenchido.
    await adminClient.query(
      "update public.store_logo_sources set verified_url = url, verified_at = now(), verified_status = 'accepted' where store_id = $1",
      [alreadyDone],
    );
    await adminClient.query("update public.stores set logo_url = 'https://example.test/x.webp', logo_hash = 'deadbeef' where id = $1", [
      alreadyDone,
    ]);

    const candidates = await selectCandidateStores(writerPool, { storeIds: [withoutLogo, alreadyDone] });
    const candidateIds = candidates.map((c) => c.storeId);

    expect(candidateIds).toContain(withoutLogo);
    expect(candidateIds).not.toContain(alreadyDone);
  });

  it("re-selects a store with a final logo once one of its sources' URL changes", async () => {
    const storeId = await insertStore("url-changed");
    await insertSource(storeId, "zoom", `${baseUrl}/square-big.webp`);
    await adminClient.query(
      "update public.store_logo_sources set verified_url = url, verified_at = now(), verified_status = 'accepted' where store_id = $1",
      [storeId],
    );
    await adminClient.query("update public.stores set logo_url = 'https://example.test/x.webp', logo_hash = 'deadbeef' where id = $1", [
      storeId,
    ]);

    // A plataforma trocou a URL (T11 upsert já cobre isso) — verified_url fica pra trás.
    await adminClient.query("update public.store_logo_sources set url = $2 where store_id = $1", [storeId, `${baseUrl}/square-big.png`]);

    const candidates = await selectCandidateStores(writerPool, { storeIds: [storeId] });
    expect(candidates.map((c) => c.storeId)).toContain(storeId);
  });

  it("prefers a square source over a wider banner and records verification metadata for both", async () => {
    const storeId = await insertStore("square-vs-banner");
    await insertSource(storeId, "zoom", `${baseUrl}/square-big.webp`);
    await insertSource(storeId, "mycashback", `${baseUrl}/banner.jpg`);

    const [candidate] = await selectCandidateStores(writerPool, { storeIds: [storeId] });
    const result = await processStore(writerPool, storage, candidate!, fetchOptions);
    if (result.changed) trackUploads(`${storeId}/${(await fetchStore(storeId)).logo_hash}.webp`);

    expect(result.changed).toBe(true);
    const expected = await normalizeLogoImage(squareBig);
    const store = await fetchStore(storeId);
    expect(store.logo_hash).toBe(expected.contentHash);
    expect(store.logo_url).toBe(storage.publicUrlFor(`${storeId}/${expected.contentHash}.webp`));
    expect(await objectExists(`${storeId}/${expected.contentHash}.webp`)).toBe(true);

    const zoomSource = await fetchSource(storeId, "zoom");
    expect(zoomSource).toMatchObject({ verified_status: "accepted", width: 150, height: 150 });
    const bannerSource = await fetchSource(storeId, "mycashback");
    expect(bannerSource).toMatchObject({ verified_status: "accepted", width: 250, height: 80 });
  });

  it("prefers higher resolution among square sources", async () => {
    const storeId = await insertStore("square-resolution");
    await insertSource(storeId, "cuponomia", `${baseUrl}/square-small.webp`);
    await insertSource(storeId, "zoom", `${baseUrl}/square-big.webp`);

    const [candidate] = await selectCandidateStores(writerPool, { storeIds: [storeId] });
    const result = await processStore(writerPool, storage, candidate!, fetchOptions);
    const store = await fetchStore(storeId);
    if (result.changed) trackUploads(`${storeId}/${store.logo_hash}.webp`);

    const expected = await normalizeLogoImage(squareBig);
    expect(store.logo_hash).toBe(expected.contentHash);
  });

  it("rejects invalid image content without crashing the store, leaving the visual fallback (no logo_url)", async () => {
    const storeId = await insertStore("invalid-content");
    await insertSource(storeId, "meliuz", `${baseUrl}/invalid`);

    const [candidate] = await selectCandidateStores(writerPool, { storeIds: [storeId] });
    const result = await processStore(writerPool, storage, candidate!, fetchOptions);

    expect(result.changed).toBe(false);
    expect(result.hasFinalLogo).toBe(false);
    expect(result.rejections).toEqual([{ platformId: "meliuz", errorClass: "invalid_image", networkDetail: null }]);
    const store = await fetchStore(storeId);
    expect(store.logo_url).toBeNull();
    expect(store.logo_hash).toBeNull();

    const source = await fetchSource(storeId, "meliuz");
    expect(source).toMatchObject({ verified_status: "rejected" });
    expect(source.rejection_reason).toBeTruthy();
    expect(source.verified_at).not.toBeNull();
  });

  it("rejects an untrusted/unsafe source URL without crashing the store", async () => {
    const storeId = await insertStore("ssrf-blocked");
    await insertSource(storeId, "inter", "http://10.0.0.5:1/logo.png");

    const [candidate] = await selectCandidateStores(writerPool, { storeIds: [storeId] });
    const result = await processStore(writerPool, storage, candidate!, fetchOptions);

    expect(result.changed).toBe(false);
    expect(result.hasFinalLogo).toBe(false);
    expect(result.rejections).toEqual([{ platformId: "inter", errorClass: "unsafe_url", networkDetail: null }]);
    const store = await fetchStore(storeId);
    expect(store.logo_url).toBeNull();

    const source = await fetchSource(storeId, "inter");
    expect(source).toMatchObject({ verified_status: "rejected" });
    expect(source.rejection_reason).toMatch(/não confiável|unsafe/i);
  });

  it("uploads before swapping the pointer: a pointer-update failure after a successful upload leaves the previous pointer intact", async () => {
    const storeId = await insertStore("upload-then-pointer-fails");
    await insertSource(storeId, "zoom", `${baseUrl}/square-big.webp`);
    await adminClient.query("update public.stores set logo_url = 'https://example.test/previous.webp', logo_hash = 'previous-hash' where id = $1", [
      storeId,
    ]);

    const [candidate] = await selectCandidateStores(writerPool, { storeIds: [storeId] });
    const failingPool = poolThatFailsPointerUpdate(writerPool);

    await expect(processStore(failingPool, storage, candidate!, fetchOptions)).rejects.toThrow(/simulated failure/);

    const expected = await normalizeLogoImage(squareBig);
    trackUploads(`${storeId}/${expected.contentHash}.webp`);
    expect(await objectExists(`${storeId}/${expected.contentHash}.webp`)).toBe(true);

    const store = await fetchStore(storeId);
    expect(store.logo_hash).toBe("previous-hash"); // ponteiro anterior nunca foi tocado
    expect(store.logo_url).toBe("https://example.test/previous.webp");

    // O diagnóstico de verificação NÃO foi persistido (de propósito — ver processStore): a
    // fonte continua com verified_url divergente de url, então a loja segue candidata e o
    // próximo run tenta de novo, em vez de ficar presa achando que já processou.
    const source = await fetchSource(storeId, "zoom");
    expect(source.verified_url).toBeNull();

    const retryCandidates = await selectCandidateStores(writerPool, { storeIds: [storeId] });
    expect(retryCandidates.map((c) => c.storeId)).toContain(storeId);

    const retryResult = await processStore(writerPool, storage, retryCandidates[0]!, fetchOptions);
    expect(retryResult.changed).toBe(true);
    const storeAfterRetry = await fetchStore(storeId);
    expect(storeAfterRetry.logo_hash).toBe(expected.contentHash);
  });

  it("does not re-upload or invalidate the catalog when re-verification yields byte-identical content (content-based dedup)", async () => {
    const storeId = await insertStore("content-dedup");
    await insertSource(storeId, "zoom", `${baseUrl}/square-big.webp`);

    let invalidations = 0;
    const invalidate = async () => {
      invalidations++;
    };

    const first = await ingestLogos(writerPool, storage, invalidate, fetchOptions, { storeIds: [storeId] });
    expect(first.storesChanged).toBe(1);
    expect(invalidations).toBe(1);
    const afterFirst = await fetchStore(storeId);
    trackUploads(`${storeId}/${afterFirst.logo_hash}.webp`);

    // A plataforma trocou a URL, mas o conteúdo normalizado é PIXEL-IDÊNTICO (PNG dos
    // mesmos pixels do WebP original) — fonte "nova", mas sem upload nem invalidação novos.
    await adminClient.query("update public.store_logo_sources set url = $2 where store_id = $1 and platform_id = 'zoom'", [
      storeId,
      `${baseUrl}/square-big.png`,
    ]);

    const second = await ingestLogos(writerPool, storage, invalidate, fetchOptions, { storeIds: [storeId] });
    expect(second.storesConsidered).toBe(1); // ainda candidata (url mudou) — mas sem mudança efetiva
    expect(second.storesChanged).toBe(0);
    expect(invalidations).toBe(1); // não invalidou de novo

    const afterSecond = await fetchStore(storeId);
    expect(afterSecond.logo_hash).toBe(afterFirst.logo_hash);
  });

  // "network_or_http" sozinho não distingue o que é nosso do que não é: a ADR-0057 nasceu de
  // 2182 falhas dessa classe que eram um defeito do cliente. O detalhe separa isso de uma
  // fonte que a plataforma simplesmente removeu, onde o fallback é a resposta honesta.
  it("labels a network failure with its HTTP status, so a dead source is not read as a broken client", async () => {
    const storeId = await insertStore("dead-source");
    await insertSource(storeId, "meliuz", `${baseUrl}/gone`);

    const summary = await ingestLogos(writerPool, storage, async () => {}, fetchOptions, { storeIds: [storeId] });

    expect(summary.rejectionsByClass.network_or_http).toBe(1);
    expect(summary.networkFailureDetails).toEqual({ http_404: 1 });
    expect(summary.storesFallback).toBe(1);
  });

  it("does not invalidate the catalog on a run where nothing needed to change", async () => {
    const storeId = await insertStore("no-op-run");
    await insertSource(storeId, "meliuz", `${baseUrl}/invalid`);

    let invalidations = 0;
    const summary = await ingestLogos(writerPool, storage, async () => void invalidations++, fetchOptions, { storeIds: [storeId] });

    expect(summary.storesChanged).toBe(0);
    expect(invalidations).toBe(0);
  });

  it("reports an empty, no-op summary when there are no candidate stores to process (F3/T16/#62)", async () => {
    let invalidations = 0;
    const summary = await ingestLogos(writerPool, storage, async () => void invalidations++, fetchOptions, { storeIds: [] });

    expect(summary).toEqual({
      storesConsidered: 0,
      storesChanged: 0,
      storesFailed: 0,
      storesFallback: 0,
      rejectionsByClass: { unsafe_url: 0, download_too_large: 0, invalid_image: 0, network_or_http: 0 },
      networkFailureDetails: {},
      errors: [],
      catalogInvalidationError: null,
    });
    expect(invalidations).toBe(0);
  });

  // Os ponteiros já estão gravados quando a invalidação roda. Deixar a exceção escapar
  // descartava o diagnóstico inteiro do run (ADR-0057) — o run ainda falha, mas depois de
  // reportar o que fez, e o catálogo se corrige sozinho no TTL.
  it("keeps the pointer and reports the failure when catalog invalidation is refused", async () => {
    const storeId = await insertStore("invalidation-refused");
    await insertSource(storeId, "zoom", `${baseUrl}/square-big.webp`);

    const summary = await ingestLogos(
      writerPool,
      storage,
      async () => {
        throw new Error("Catalog invalidation returned HTTP 401");
      },
      fetchOptions,
      { storeIds: [storeId] },
    );

    expect(summary.storesChanged).toBe(1);
    expect(summary.storesFailed).toBe(0);
    expect(summary.catalogInvalidationError).toBe("Catalog invalidation returned HTTP 401");

    const stored = await fetchStore(storeId);
    expect(stored.logo_url).not.toBeNull();
    expect(stored.logo_hash).not.toBeNull();
    trackUploads(`${storeId}/${stored.logo_hash}.webp`);
  });

  it("aggregates fallback and rejection-class diagnostics across a mixed partial batch (F3/T16/#62)", async () => {
    const succeeds = await insertStore("batch-succeeds");
    await insertSource(succeeds, "zoom", `${baseUrl}/square-big.webp`);

    const staysFallback = await insertStore("batch-fallback");
    await insertSource(staysFallback, "meliuz", `${baseUrl}/invalid`);

    const blocked = await insertStore("batch-ssrf");
    await insertSource(blocked, "inter", "http://10.0.0.5:1/logo.png");

    const summary = await ingestLogos(writerPool, storage, async () => {}, fetchOptions, {
      storeIds: [succeeds, staysFallback, blocked],
    });
    trackUploads(`${succeeds}/${(await fetchStore(succeeds)).logo_hash}.webp`);

    expect(summary.storesConsidered).toBe(3);
    expect(summary.storesChanged).toBe(1);
    expect(summary.storesFailed).toBe(0);
    expect(summary.storesFallback).toBe(2);
    expect(summary.rejectionsByClass).toEqual({
      unsafe_url: 1,
      download_too_large: 0,
      invalid_image: 1,
      network_or_http: 0,
    });
  });
});

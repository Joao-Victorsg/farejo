import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

// F3/T14 (#60, ADR-0038/ADR-0042): fronteira de Storage para logos finais.
//
// Credenciais fixas do stack local (`supabase start`): JWT/S3 keys demo do Supabase CLI,
// idênticas em todo projeto local, nunca usadas em produção (mesmo padrão de
// apps/scraper/src/localDb.ts).
const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const storageApiUrl = "http://127.0.0.1:55321";
const s3Endpoint = `${storageApiUrl}/storage/v1/s3`;
const s3AccessKeyId = "625729a08b95bf1b7ff351a663f3a23c";
const s3SecretAccessKey = "850181e4652dd023b7a98c58ae0d2d34bd487ee0cc3254aed6eda37307425907";

const fixturePrefix = "issue60-store-logos-";
const client = new Client({ connectionString: databaseUrl });

function makeS3(credentials: { accessKeyId: string; secretAccessKey: string }) {
  return new S3Client({
    endpoint: s3Endpoint,
    region: "local",
    forcePathStyle: true,
    credentials,
  });
}

const s3 = makeS3({ accessKeyId: s3AccessKeyId, secretAccessKey: s3SecretAccessKey });

// WebP 1x1 válido (menor arquivo possível que o Storage aceita como image/webp real).
const tinyWebp = Buffer.from("UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAfQ//73v/+BiOh/AAA=", "base64");

async function insertStore(suffix: string, name: string) {
  const slug = `${fixturePrefix}${suffix}`;
  const { rows } = await client.query<{ id: number }>("insert into public.stores (slug, name) values ($1, $2) returning id", [slug, name]);
  const store = rows[0];
  if (!store) throw new Error("Fixture store was not inserted");
  return { id: store.id, slug };
}

async function cleanFixtures() {
  await client.query("delete from public.store_logo_sources where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.stores where slug like $1", [`${fixturePrefix}%`]);
}

async function deleteObjectQuiet(key: string) {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: "store-logos", Key: key }));
  } catch {
    // objeto pode não existir se o upload do teste falhou antes — não é o que está sob teste aqui.
  }
}

beforeAll(async () => {
  await client.connect();
  await cleanFixtures();
});

afterAll(async () => {
  await cleanFixtures();
  await client.end();
});

describe("store-logos bucket", () => {
  it("is created idempotently with public read and the expected mime/size limits", async () => {
    const before = await client.query(
      "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'store-logos'",
    );
    expect(before.rows).toEqual([{ public: true, file_size_limit: "2097152", allowed_mime_types: ["image/webp"] }]);

    // Reaplica o upsert da migration: reproduzível, sem duplicar linha nem mudar config.
    await client.query(
      `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
       values ('store-logos', 'store-logos', true, 2097152, array['image/webp'])
       on conflict (id) do update set
         public             = excluded.public,
         file_size_limit    = excluded.file_size_limit,
         allowed_mime_types = excluded.allowed_mime_types`,
    );

    const after = await client.query("select count(*)::int as count from storage.buckets where id = 'store-logos'");
    expect(after.rows[0].count).toBe(1);
  });

  it("accepts an authorized S3 upload and serves it publicly without login", async () => {
    const key = `${fixturePrefix}public-read.webp`;
    await s3.send(new PutObjectCommand({ Bucket: "store-logos", Key: key, Body: tinyWebp, ContentType: "image/webp" }));

    try {
      const response = await fetch(`${storageApiUrl}/storage/v1/object/public/store-logos/${key}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/webp");
    } finally {
      await deleteObjectQuiet(key);
    }
  });

  it("rejects a disallowed mime type and an oversized upload even for the authorized S3 key", async () => {
    await expect(
      s3.send(new PutObjectCommand({ Bucket: "store-logos", Key: `${fixturePrefix}wrong-mime.png`, Body: tinyWebp, ContentType: "image/png" })),
    ).rejects.toThrow(/mime type/i);

    const oversized = Buffer.alloc(3 * 1024 * 1024, 0);
    await expect(
      s3.send(new PutObjectCommand({ Bucket: "store-logos", Key: `${fixturePrefix}too-big.webp`, Body: oversized, ContentType: "image/webp" })),
    ).rejects.toThrow(/exceeded the maximum allowed size/i);
  });

  it("refuses uploads from an S3 client without valid credentials", async () => {
    const anonymousS3 = makeS3({ accessKeyId: "not-a-real-key", secretAccessKey: "not-a-real-secret" });
    await expect(
      anonymousS3.send(new PutObjectCommand({ Bucket: "store-logos", Key: `${fixturePrefix}no-creds.webp`, Body: tinyWebp, ContentType: "image/webp" })),
    ).rejects.toThrow();
  });

  it("denies upload, overwrite and delete on storage.objects to anon, authenticated and farejo_web", async () => {
    // Linha real (via S3, que ignora RLS) para que UPDATE/DELETE tenham algo a mirar —
    // sem uma linha existente, um UPDATE/DELETE que casa 0 linhas "passa" mesmo sob RLS,
    // o que não prova nada sobre a negação. Storage tem um trigger que recusa DELETE
    // direto via SQL em qualquer role ("Use the Storage API instead"), então a linha
    // também só pode ser removida de volta pela mesma via (S3), nunca por SQL cru.
    const existingKey = `${fixturePrefix}existing-object.webp`;
    await s3.send(new PutObjectCommand({ Bucket: "store-logos", Key: existingKey, Body: tinyWebp, ContentType: "image/webp" }));

    try {
      for (const roleName of ["anon", "authenticated"]) {
        await client.query(`set role ${roleName}`);
        try {
          // INSERT sempre lança: o WITH CHECK da linha nova falha explicitamente sem
          // policy de insert.
          await expect(
            client.query("insert into storage.objects (bucket_id, name) values ('store-logos', $1)", [`${fixturePrefix}${roleName}-insert.webp`]),
          ).rejects.toThrow(/row-level security/i);

          // UPDATE sem policy própria (só existe policy de select) não lança erro: a linha
          // fica invisível para o USING da escrita, então o comando "roda" e afeta 0
          // linhas — a prova de negação aqui é `rowCount === 0`, não uma exceção.
          const updateResult = await client.query("update storage.objects set name = $1 where bucket_id = 'store-logos' and name = $2", [
            `${fixturePrefix}${roleName}-renamed.webp`,
            existingKey,
          ]);
          expect(updateResult.rowCount).toBe(0);

          // DELETE direto por SQL é recusado por trigger do Storage para qualquer role,
          // não só por RLS.
          await expect(client.query("delete from storage.objects where bucket_id = 'store-logos' and name = $1", [existingKey])).rejects.toThrow(
            /direct deletion/i,
          );

          // Leitura pública continua permitida — só escrita é negada.
          await expect(client.query("select * from storage.objects where bucket_id = 'store-logos'")).resolves.toHaveProperty("rows");
        } finally {
          await client.query("reset role");
        }
      }

      const stillIntact = await client.query("select name from storage.objects where bucket_id = 'store-logos' and name = $1", [existingKey]);
      expect(stillIntact.rows).toHaveLength(1);

      await client.query("set role farejo_web");
      try {
        await expect(client.query("select * from storage.objects where bucket_id = 'store-logos'")).rejects.toThrow(/permission denied/i);
        // farejo_web nunca teve GRANT em storage.objects (só lê o catálogo via web_read) —
        // toda escrita falha antes mesmo de qualquer policy entrar em jogo.
        await expect(
          client.query("insert into storage.objects (bucket_id, name) values ('store-logos', $1)", [`${fixturePrefix}farejo-web-insert.webp`]),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          client.query("update storage.objects set name = $1 where bucket_id = 'store-logos' and name = $2", ["renamed.webp", existingKey]),
        ).rejects.toThrow(/permission denied/i);
        await expect(client.query("delete from storage.objects where bucket_id = 'store-logos' and name = $1", [existingKey])).rejects.toThrow(
          /permission denied/i,
        );
      } finally {
        await client.query("reset role");
      }
    } finally {
      await deleteObjectQuiet(existingKey);
    }
  });

  it("lets farejo_logo_writer read pending sources and update only the logo pointer columns on stores", async () => {
    const store = await insertStore("writer", "Issue60 Loja Writer");
    await client.query(
      "insert into public.store_logo_sources (store_id, platform_id, url, last_seen_at) values ($1, 'meliuz', 'https://example.test/logo.png', now())",
      [store.id],
    );

    await client.query("set role farejo_logo_writer");
    try {
      const sources = await client.query("select store_id, url from public.store_logo_sources where store_id = $1", [store.id]);
      expect(sources.rows).toEqual([{ store_id: String(store.id), url: "https://example.test/logo.png" }]);

      await expect(
        client.query("update public.stores set logo_url = $1, logo_hash = $2 where id = $3", ["https://cdn.example.test/x.webp", "abc123", store.id]),
      ).resolves.toHaveProperty("rowCount", 1);

      await expect(client.query("update public.stores set name = $1 where id = $2", ["Hacked", store.id])).rejects.toThrow(/permission denied/i);
      await expect(client.query("select * from public.offers limit 1")).rejects.toThrow(/permission denied/i);
      await expect(client.query("select * from public.store_aliases limit 1")).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("reset role");
    }
  });

  it("keeps anon, authenticated and farejo_web away from store_logo_sources", async () => {
    const store = await insertStore("no-access", "Issue60 Sem Acesso");
    await client.query(
      "insert into public.store_logo_sources (store_id, platform_id, url, last_seen_at) values ($1, 'meliuz', 'https://example.test/logo.png', now())",
      [store.id],
    );

    for (const roleName of ["anon", "authenticated", "farejo_web"]) {
      await client.query(`set role ${roleName}`);
      try {
        await expect(client.query("select * from public.store_logo_sources where store_id = $1", [store.id])).rejects.toThrow(/permission denied/i);
      } finally {
        await client.query("reset role");
      }
    }
  });
});

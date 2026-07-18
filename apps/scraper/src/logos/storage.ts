import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

/**
 * Fronteira de Storage do ingestor de logos (ADR-0042): chave S3 do Supabase, separada da
 * conexão Postgres, restrita ao bucket público `store-logos` (20260718060000). A chave em si
 * tecnicamente alcança qualquer bucket do projeto (limitação da plataforma, já registrada na
 * ADR-0042) — esta camada só declara a intenção, não impõe o escopo.
 */
const StorageEnvironment = z.object({
  FAREJO_LOGO_S3_ENDPOINT: z.string().url(),
  FAREJO_LOGO_S3_ACCESS_KEY_ID: z.string().min(1),
  FAREJO_LOGO_S3_SECRET_ACCESS_KEY: z.string().min(1),
  FAREJO_LOGO_S3_REGION: z.string().min(1),
  // Prefixo completo de leitura pública, ex.:
  // "https://<project>.supabase.co/storage/v1/object/public/store-logos" — publicUrlFor só
  // concatena "/{key}".
  FAREJO_LOGO_PUBLIC_BASE_URL: z.string().url(),
});

const BUCKET = "store-logos";

export interface LogoStorage {
  upload(key: string, body: Buffer): Promise<void>;
  publicUrlFor(key: string): string;
}

export function createLogoStorage(environment: Record<string, string | undefined> = process.env): LogoStorage {
  const config = StorageEnvironment.parse(environment);
  const client = new S3Client({
    endpoint: config.FAREJO_LOGO_S3_ENDPOINT,
    region: config.FAREJO_LOGO_S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.FAREJO_LOGO_S3_ACCESS_KEY_ID,
      secretAccessKey: config.FAREJO_LOGO_S3_SECRET_ACCESS_KEY,
    },
  });

  return {
    async upload(key, body) {
      await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: "image/webp" }));
    },
    publicUrlFor(key) {
      return `${config.FAREJO_LOGO_PUBLIC_BASE_URL}/${key}`;
    },
  };
}

/** Caminho endereçado por conteúdo (ADR-0014): dedup natural, sem depender da URL de origem. */
export function logoObjectKey(storeId: number, contentHash: string): string {
  return `${storeId}/${contentHash}.webp`;
}

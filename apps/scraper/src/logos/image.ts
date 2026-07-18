import { createHash } from "node:crypto";
import sharp from "sharp";

/**
 * Normalização de logo (F3/T15/#61, ADR-0014). `bytes` já passou pelo `safeFetchBytes` — este
 * módulo só valida que o CONTEÚDO é mesmo uma imagem (magic byte + decodificação real, nunca
 * confiando no Content-Type declarado pelo servidor) e produz o WebP quadrado ~128px publicado.
 */
export class InvalidImageError extends Error {}

export interface NormalizedLogo {
  webp: Buffer;
  contentHash: string;
  /** Dimensões da imagem ORIGINAL (pré-normalização) — usadas para ranking, nunca 128x128. */
  sourceWidth: number;
  sourceHeight: number;
}

const OUTPUT_SIZE = 128;
// Generoso o bastante para qualquer logo real; barra decode bomb (arquivo pequeno, dimensão
// gigante) antes de decodificar o corpo inteiro.
const MAX_INPUT_PIXELS = 50_000_000;
const WEBP_QUALITY = 82;

type ImageFamily = "png" | "jpeg" | "webp" | "gif";

const MAGIC_SIGNATURES: Array<{ family: ImageFamily; matches: (buf: Buffer) => boolean }> = [
  { family: "png", matches: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { family: "jpeg", matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { family: "webp", matches: (b) => b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
  { family: "gif", matches: (b) => b.length >= 6 && ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("ascii")) },
];

function sniffFamily(bytes: Buffer): ImageFamily | null {
  return MAGIC_SIGNATURES.find((sig) => sig.matches(bytes))?.family ?? null;
}

/**
 * Valida magic byte + decodificação real (sharp) e normaliza para WebP quadrado ~128px com
 * fundo transparente (`fit: contain`, nunca corta a marca). Rejeita qualquer coisa que não
 * seja PNG/JPEG/WEBP/GIF reais — nunca confia em `Content-Type`, nunca decodifica SVG.
 */
export async function normalizeLogoImage(bytes: Buffer): Promise<NormalizedLogo> {
  const family = sniffFamily(bytes);
  if (!family) throw new InvalidImageError("Conteúdo não corresponde ao magic byte de nenhum formato de imagem suportado");

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).metadata();
  } catch (error) {
    throw new InvalidImageError(`Falha ao decodificar imagem: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (metadata.format !== family) {
    throw new InvalidImageError(`Magic byte indica "${family}", mas o decoder identificou "${metadata.format}"`);
  }
  if (!metadata.width || !metadata.height) {
    throw new InvalidImageError("Imagem decodificada sem dimensões válidas");
  }

  let webp: Buffer;
  try {
    webp = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
      .rotate()
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch (error) {
    throw new InvalidImageError(`Falha ao normalizar imagem: ${error instanceof Error ? error.message : String(error)}`);
  }

  const contentHash = createHash("sha256").update(webp).digest("hex");
  return { webp, contentHash, sourceWidth: metadata.width, sourceHeight: metadata.height };
}

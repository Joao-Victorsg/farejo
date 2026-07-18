import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { InvalidImageError, normalizeLogoImage } from "./image.js";

async function makePng(width: number, height: number, color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

async function makeJpeg(width: number, height: number, color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}

describe("normalizeLogoImage", () => {
  it("normalizes a square PNG into a 128x128 WebP and reports the original dimensions", async () => {
    const png = await makePng(200, 200, { r: 10, g: 20, b: 30 });
    const result = await normalizeLogoImage(png);

    expect(result.sourceWidth).toBe(200);
    expect(result.sourceHeight).toBe(200);
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const outputMetadata = await sharp(result.webp).metadata();
    expect(outputMetadata.format).toBe("webp");
    expect(outputMetadata.width).toBe(128);
    expect(outputMetadata.height).toBe(128);
  });

  it("keeps the ORIGINAL (non-square) dimensions for a wide banner, even though the output is square", async () => {
    const banner = await makeJpeg(250, 80, { r: 200, g: 200, b: 200 });
    const result = await normalizeLogoImage(banner);

    expect(result.sourceWidth).toBe(250);
    expect(result.sourceHeight).toBe(80);
    const outputMetadata = await sharp(result.webp).metadata();
    expect(outputMetadata.width).toBe(128);
    expect(outputMetadata.height).toBe(128);
  });

  it("is deterministic: normalizing the same bytes twice yields the same content hash", async () => {
    const png = await makePng(150, 150, { r: 5, g: 6, b: 7 });
    const first = await normalizeLogoImage(png);
    const second = await normalizeLogoImage(png);
    expect(first.contentHash).toBe(second.contentHash);
  });

  it("produces the same content hash for pixel-identical images encoded in different lossless containers (dedup)", async () => {
    const png = await makePng(180, 180, { r: 111, g: 33, b: 200 });
    const losslessWebp = await sharp(png).webp({ lossless: true }).toBuffer();

    const fromPng = await normalizeLogoImage(png);
    const fromWebp = await normalizeLogoImage(losslessWebp);
    expect(fromPng.contentHash).toBe(fromWebp.contentHash);
  });

  it("rejects content that matches no known image magic byte", async () => {
    await expect(normalizeLogoImage(Buffer.from("<html>not an image</html>"))).rejects.toBeInstanceOf(InvalidImageError);
  });

  it("rejects a truncated/corrupted file even with a valid magic byte header", async () => {
    const png = await makePng(64, 64, { r: 1, g: 2, b: 3 });
    const truncated = png.subarray(0, 20);
    await expect(normalizeLogoImage(truncated)).rejects.toBeInstanceOf(InvalidImageError);
  });

  it("rejects an empty buffer", async () => {
    await expect(normalizeLogoImage(Buffer.alloc(0))).rejects.toBeInstanceOf(InvalidImageError);
  });
});

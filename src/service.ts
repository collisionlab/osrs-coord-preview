import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { S3Client, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { parseCoordinateItems } from "./input.js";
import { renderBatch, resolveTileCoordinate } from "./render.js";
import { CACHE_CONTROL, objectKey } from "./config.js";
import type { RenderOptions, RenderResult, RenderServiceResponse } from "./types.js";

export interface ImageStore {
  has(key: string): Promise<boolean>;
  put(key: string, image: Uint8Array): Promise<void>;
}
export function imageStore(): ImageStore {
  if (process.env.PUBLISH_MODE === "local") {
    const dir = process.env.LOCAL_PUBLISH_DIR;
    if (!dir) throw new Error("LOCAL_PUBLISH_DIR is required");
    return {
      async has(key) { try { await fs.access(path.join(dir, key)); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; } },
      async put(key, bytes) {
        await fs.mkdir(dir, { recursive: true });
        const temp = await fs.mkdtemp(path.join(dir, ".upload-"));
        try { await fs.writeFile(path.join(temp, key), bytes); await fs.rename(path.join(temp, key), path.join(dir, key)); }
        finally { await fs.rm(temp, { recursive: true, force: true }); }
      }
    };
  }
  const Bucket = process.env.R2_BUCKET;
  if (!Bucket || !process.env.R2_ENDPOINT || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY)
    throw new Error("R2 upload configuration is required");
  const client = new S3Client({ region: "auto", endpoint: process.env.R2_ENDPOINT, requestChecksumCalculation: "WHEN_REQUIRED" });
  return {
    async has(Key) {
      try { await client.send(new HeadObjectCommand({ Bucket, Key })); return true; }
      catch (error) { if ((error as { $metadata?: { httpStatusCode: number } }).$metadata?.httpStatusCode === 404) return false; throw error; }
    },
    async put(Key, Body) { await client.send(new PutObjectCommand({ Bucket, Key, Body, ContentType: "image/png", CacheControl: CACHE_CONTROL })); }
  };
}

export async function handleRenderRequest(rawBody: string, store = imageStore(), options: Partial<RenderOptions> = {}): Promise<RenderServiceResponse> {
  const items = parseCoordinateItems(rawBody);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "osrs-render-"));
  const results: RenderResult[] = [];
  const base = (process.env.PUBLIC_BASE_URL ?? "https://tiles.collisionlab.world/previews/images").replace(/\/+$/, "");
  try {
    for (const item of items) {
      try {
        const config = { ...options, style: item.style ?? options.style };
        const key = await objectKey(item, config);
        if (!await store.has(key)) {
          const rendered = (await renderBatch([item], { ...config, outputDir: temp })).items[0];
          if (rendered.status === "failure") { results.push(rendered); continue; }
          await store.put(key, await fs.readFile(rendered.imagePath!));
        }
        results.push({ status: "success", id: item.id, label: item.label, source: item.source,
          coordinate: item.coordinate, resolved: resolveTileCoordinate(item.parsed.x, item.parsed.y), imageUrl: `${base}/${key}` });
      } catch (error) {
        results.push({ status: "failure", id: item.id, label: item.label, source: item.source, coordinate: item.coordinate, error: (error as Error).message });
      }
    }
    return { renderCount: results.filter(r => r.status === "success").length, failedCount: results.filter(r => r.status === "failure").length, items: results };
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}

/// <reference types="@cloudflare/workers-types" />
import { parseCoordinateItems } from "./input.js";
import { CACHE_CONTROL, MAX_BODY_BYTES, objectKey } from "./config.js";
import { resolveTileCoordinate } from "./geometry.js";
import type { RenderResult, RenderServiceResponse } from "./types.js";

interface Env {
  IMAGES: R2Bucket;
  ORIGIN_URL: string;
  ORIGIN_TOKEN: string;
  RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
declare const caches: CacheStorage & { default: Cache };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" }
});
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const image = /^\/previews\/images\/([a-f0-9]{64}\.png)$/.exec(url.pathname);
    if (image) {
      if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
      const cacheKey = new Request(`${url.origin}${url.pathname}`);
      const cached = await caches.default.match(cacheKey);
      if (cached) {
        if (request.headers.get("if-none-match") === cached.headers.get("etag")) return new Response(null, { status: 304, headers: cached.headers });
        return request.method === "HEAD" ? new Response(null, { headers: cached.headers }) : cached;
      }
      const object = request.method === "HEAD" ? await env.IMAGES.head(image[1]) : await env.IMAGES.get(image[1]);
      if (!object) return json({ error: "Image not found" }, 404);
      const headers = { "content-type": "image/png", "cache-control": CACHE_CONTROL,
        "content-length": String(object.size), etag: object.httpEtag, "x-content-type-options": "nosniff" };
      if (request.headers.get("if-none-match") === object.httpEtag) return new Response(null, { status: 304, headers });
      const response = new Response(request.method === "GET" ? (object as R2ObjectBody).body as unknown as BodyInit : null, { headers });
      if (request.method === "GET") ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
      return response;
    }
    if (url.pathname !== "/previews/v1/render") return json({ error: "Not found" }, 404);
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    if (!(await env.RATE_LIMITER.limit({ key: request.headers.get("cf-connecting-ip") ?? "unknown" })).success)
      return new Response(null, { status: 429, headers: { "retry-after": "60" } });
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ error: "Expected application/json" }, 415);
    let raw = "";
    try {
      let bytes = 0;
      if (request.body) {
        const reader = request.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_BODY_BYTES) { await reader.cancel(); return json({ error: "Input too large" }, 413); }
          raw += decoder.decode(value, { stream: true });
        }
        raw += decoder.decode();
      }
      const items = parseCoordinateItems(raw);
      const results: RenderResult[] = [];
      for (const item of items) {
        const key = await objectKey(item, { style: item.style });
        if (await env.IMAGES.head(key)) {
          results.push({ status: "success", id: item.id, label: item.label, source: item.source, coordinate: item.coordinate,
            resolved: resolveTileCoordinate(item.parsed.x, item.parsed.y), imageUrl: `${url.origin}/previews/images/${key}` });
          continue;
        }
        try {
          const response = await fetch(env.ORIGIN_URL, { method: "POST", redirect: "manual",
            headers: { "content-type": "application/json", authorization: `Bearer ${env.ORIGIN_TOKEN}` },
            body: JSON.stringify([{ coordinate: item.coordinate, id: item.id, label: item.label, source: item.source, style: item.style }]),
            signal: AbortSignal.timeout(25000) });
          if (!response.ok) throw new Error(`Renderer unavailable (${response.status})`);
          const data = await response.json() as RenderServiceResponse;
          const rendered = data.items[0];
          if (!rendered || !["success", "failure"].includes(rendered.status)) throw new Error("Invalid renderer response");
          if (rendered.status === "success") {
            if (!await env.IMAGES.head(key)) throw new Error("Renderer did not publish the expected image");
            rendered.imageUrl = `${url.origin}/previews/images/${key}`;
          }
          results.push(rendered);
        } catch (error) {
          console.error("preview-render-failed", error instanceof Error ? error.message : "Unknown error");
          results.push({ status: "failure", id: item.id, label: item.label, source: item.source, coordinate: item.coordinate, error: "Rendering failed; retry later" });
        }
      }
      console.log(JSON.stringify({ event: "preview-batch", failures: results.filter(r => r.status === "failure").length, total: results.length }));
      return json({ renderCount: results.filter(r => r.status === "success").length,
        failedCount: results.filter(r => r.status === "failure").length, items: results });
    } catch (error) { return json({ error: (error as Error).message }, 400); }
  }
};

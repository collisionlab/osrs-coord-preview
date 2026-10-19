import fs from "node:fs/promises";
import http, { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { handleRenderRequest } from "./service.js";
import { CACHE_CONTROL, MAX_BODY_BYTES } from "./config.js";
import { parseCoordinateItems } from "./input.js";

sharp.concurrency(1);
sharp.cache(false);
let outstanding = 0;
const reply = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(value));
};
export async function requestListener(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") { reply(res, 200, { ok: true }); return; }
  const local = process.env.PUBLISH_MODE === "local";
  if (local && req.method === "GET" && /^\/static\/[a-f0-9]{64}\.png$/.test(url.pathname)) {
    try {
      const bytes = await fs.readFile(path.join(process.env.LOCAL_PUBLISH_DIR!, path.basename(url.pathname)));
      res.writeHead(200, { "content-type": "image/png", "cache-control": CACHE_CONTROL }); res.end(bytes);
    } catch { reply(res, 404, { error: "Not found" }); }
    return;
  }
  if (url.pathname !== "/render") { reply(res, 404, { error: "Not found" }); return; }
  if (req.method !== "POST") { res.setHeader("allow", "POST"); reply(res, 405, { error: "Method not allowed" }); return; }
  if (!local) {
    const expected = Buffer.from(`Bearer ${process.env.ORIGIN_TOKEN ?? ""}`), actual = Buffer.from(req.headers.authorization ?? "");
    if (!process.env.ORIGIN_TOKEN || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      reply(res, 401, { error: "Unauthorized" }); return;
    }
  }
  if (outstanding >= 2) { res.setHeader("retry-after", "5"); reply(res, 429, { error: "Renderer busy" }); return; }
  if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") { reply(res, 415, { error: "Expected application/json" }); return; }
  outstanding++;
  try {
    let bytes = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) { reply(res, 413, { error: "Input too large" }); return; }
      chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    try { parseCoordinateItems(raw); } catch (error) { reply(res, 400, { error: (error as Error).message }); return; }
    reply(res, 200, await handleRenderRequest(raw));
  } catch { reply(res, 500, { error: "Rendering unavailable" }); }
  finally { outstanding--; }
}
export function startServer(port = 8080) {
  const server = http.createServer((req, res) => { void requestListener(req, res); });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.listen(port);
  return server;
}
if (import.meta.url === `file://${process.argv[1]}`) startServer(Number(process.env.PORT ?? 8080));

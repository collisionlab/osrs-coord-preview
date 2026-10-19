// Run from the exact deployed renderer checkout with origin/R2 credentials.
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { imageStore } from "../src/service.js";
import { objectKey, PUBLIC_RENDER_URL } from "../src/config.js";
import { parseCoordinateItems } from "../src/input.js";
import type { RenderServiceResponse } from "../src/types.js";

const origin = process.env.ORIGIN_URL!;
assert.ok(origin?.startsWith("https://"), "ORIGIN_URL is required");
assert.ok(process.env.ORIGIN_TOKEN, "ORIGIN_TOKEN is required");
const post = (url: string, body: string, token?: string) => fetch(url, {
  method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body, signal: AbortSignal.timeout(60000), redirect: "error"
});
assert.equal((await fetch(new URL("/health", origin))).status, 200);
for (const token of [undefined, "incorrect"])
  assert.equal((await post(origin, '[]', token)).status, 401, "Origin must reject invalid credentials");
const store = imageStore();
let checked = false;
for (let attempt = 0; attempt < 32; attempt++) {
  // Stay in the real-map golden's map square; never delete historical images for a test.
  const coordinate = `${3200 + randomInt(64)}/${3200 + randomInt(64)}/${randomInt(4)}`;
  const body = JSON.stringify([{ coordinate, id: "deployment-smoke", style: "standard" }]);
  const key = await objectKey(parseCoordinateItems(body)[0]);
  if (await store.has(key)) continue;
  const publicRoute = process.env.PREVIEW_PUBLIC === "true";
  const endpoint = publicRoute ? PUBLIC_RENDER_URL : origin;
  const response = await post(endpoint, body, publicRoute ? undefined : process.env.ORIGIN_TOKEN);
  assert.equal(response.status, 200);
  const manifest = await response.json() as RenderServiceResponse;
  assert.equal(manifest.renderCount, 1, JSON.stringify(manifest));
  assert.equal(manifest.failedCount, 0);
  assert.equal(manifest.items[0].imageUrl, `https://tiles.collisionlab.world/previews/images/${key}`);
  const s3 = new S3Client({ region: "auto", endpoint: process.env.R2_ENDPOINT });
  try {
    const image = await s3.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
    assert.equal(image.ContentType, "image/png");
    assert.match(image.CacheControl!, /immutable/);
    const bytes = await image.Body!.transformToByteArray();
    assert.equal(Buffer.from(bytes).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    if (publicRoute) {
      const png = await fetch(manifest.items[0].imageUrl!, { signal: AbortSignal.timeout(30000) });
      assert.equal(png.status, 200);
      assert.equal(png.headers.get("content-type"), "image/png");
      assert.match(png.headers.get("cache-control")!, /immutable/);
      assert.deepEqual(Buffer.from(await png.arrayBuffer()), Buffer.from(bytes));
    }
  } finally { s3.destroy(); }
  const repeated = await post(endpoint, body, publicRoute ? undefined : process.env.ORIGIN_TOKEN);
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), manifest);
  console.log(`Cache miss → ${publicRoute ? "Worker → " : ""}authenticated Cloud Run → R2 PNG passed: ${manifest.items[0].imageUrl}`);
  checked = true;
  break;
}
assert.ok(checked, "No uncached smoke coordinate found; expand the checked map squares");

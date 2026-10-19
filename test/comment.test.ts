import test from "node:test";
import assert from "node:assert/strict";
import { buildCommentBody } from "../src/comment.js";
import { RenderManifest } from "../src/types.js";

test("buildCommentBody includes item metadata", () => {
  const manifest: RenderManifest = {
    tileBaseUrl: "https://example.com",
    generatedAt: new Date().toISOString(),
    renderCount: 1,
    failedCount: 0,
    items: [
      {
        status: "success",
        id: "step-1",
        label: "Step 1",
        coordinate: "3200/3200/0",
        source: "steps.json:4",
        resolved: { tileX: 12, tileY: 12, pixelX: 128, pixelY: 127 },
        imageUrl: "https://tiles.collisionlab.world/previews/images/hash.png"
      }
    ]
  };

  const body = buildCommentBody(manifest);
  assert.match(body, /<!-- osrs-coordinate-preview -->/);
  assert.match(body, /OSRS coordinate previews/);
  assert.match(body, /3200\/3200\/0/);
  assert.match(body, /steps\.json:4/);
  assert.match(body, /tiles\.collisionlab\.world\/previews\/images/);
});

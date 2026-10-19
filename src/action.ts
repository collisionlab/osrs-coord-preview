import fs from "node:fs/promises";
import path from "node:path";
import * as core from "@actions/core";
import { postOrUpdateComment } from "./comment.js";
import { parseCoordinateItems } from "./input.js";
import { RenderManifest, RenderServiceResponse } from "./types.js";

export interface ActionOptions {
  coordinatesRaw: string;
  comment: boolean;
  rendererUrl: string;
  outputDir: string;
  token?: string;
}

export async function runAction(options: ActionOptions): Promise<void> {
  // The action delegates rendering to the remote service and only owns orchestration,
  // outputs, and optional PR commenting.
  parseCoordinateItems(options.coordinatesRaw);

  const outputDir = path.resolve(options.outputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const manifest = await requestRemoteRender(options.rendererUrl, options.coordinatesRaw);
  const manifestPath = path.join(outputDir, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  core.setOutput("manifest_path", manifestPath);
  core.setOutput("render_count", String(manifest.renderCount));
  core.setOutput("failed_count", String(manifest.failedCount));
  core.summary.addHeading("OSRS coordinate previews");
  core.summary.addRaw(`Rendered ${manifest.renderCount} preview(s); ${manifest.failedCount} failure(s).`);
  await core.summary.write();

  if (options.comment) {
    if (!options.token) {
      throw new Error("Commenting is enabled but GITHUB_TOKEN is not available.");
    }
    await postOrUpdateComment(options.token, manifest);
  }

  if (manifest.failedCount > 0) {
    core.warning(`Failed to render ${manifest.failedCount} coordinate ${manifest.failedCount === 1 ? "preview" : "previews"}. See manifest and PR comment for details.`);
  }
}

async function requestRemoteRender(rendererUrl: string, coordinatesRaw: string): Promise<RenderManifest> {
  const response = await fetch(rendererUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: coordinatesRaw
  });

  if (!response.ok) {
    throw new Error(`Renderer request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as RenderServiceResponse;
  return {
    tileBaseUrl: "remote-renderer",
    generatedAt: new Date().toISOString(),
    renderCount: data.renderCount,
    failedCount: data.failedCount,
    items: data.items
  };
}

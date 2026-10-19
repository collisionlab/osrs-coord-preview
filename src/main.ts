import { PUBLIC_RENDER_URL } from "./config.js";
import * as core from "@actions/core";
import { runAction } from "./action.js";

async function main() {
  try {
    await runAction({
      coordinatesRaw: core.getInput("coordinates", { required: true }),
      comment: core.getBooleanInput("comment"),
      rendererUrl: core.getInput("renderer-url") || PUBLIC_RENDER_URL,
      token: core.getInput("github-token") || process.env.GITHUB_TOKEN,
      outputDir: core.getInput("output-dir") || ".osrs-coordinate-preview"
    });
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}

void main();

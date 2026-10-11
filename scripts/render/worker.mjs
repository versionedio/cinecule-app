// Renders the already-claimed asset, then keeps claiming and rendering until the queue is empty.
// One workflow run may be triggered per queued render, but GitHub collapses runs that are waiting
// behind a running one, so a run has to drain the queue itself or an asset could be left behind.
//
//   node scripts/render/worker.mjs <first asset id>
import { spawnSync } from "node:child_process";
import { claimNext } from "./claim.mjs";
import { client, login } from "./lib.mjs";

const MAX_RENDERS_PER_RUN = 8; // keeps one run well inside the workflow's timeout
let assetId = process.argv[2];
let rendered = 0;
let failures = 0;

while (assetId && rendered < MAX_RENDERS_PER_RUN) {
  console.log(`\n=== Rendering ${assetId} (${rendered + 1}) ===`);
  const result = spawnSync(process.execPath, ["scripts/render/render.mjs", "--asset", assetId, ...(process.env.RENDER_ART === "1" ? ["--art"] : [])], { stdio: "inherit" });
  rendered++;
  if (result.status !== 0) failures++;
  // A fresh login each time: a long render can outlive the previous token.
  const next = await claimNext(client(await login()));
  assetId = next?.id;
}

console.log(`\nDone: ${rendered} render(s), ${failures} failed.`);
process.exit(failures > 0 ? 1 : 0);

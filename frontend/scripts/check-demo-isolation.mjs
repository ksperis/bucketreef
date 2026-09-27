import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await inspect(file);
    else if (/\.(?:js|css|json|html)$/.test(file)) {
      const text = await readFile(file, "utf8");
      for (const marker of ["Read-only demo settings", "This feature is disabled in the static demo", "static demo. No external", "__bucketreefDemo", "bucketreef-demo", "Demo uploads are limited", "Simulated · saved in this browser", "demo-release.json", "DEMO-ONLY-NOT-A-REAL-SECRET"]) {
        if (text.includes(marker)) throw new Error(`Demo content leaked into normal build: ${file} (${marker})`);
      }
    }
  }
}
await inspect("dist");
console.log("Normal build contains no demo runtime, fixtures or restrictions.");

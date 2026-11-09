import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = path.join(root, "public/ocr");
const worker = path.join(root, "node_modules/tesseract.js/dist/worker.min.js");
const core = path.join(root, "node_modules/tesseract.js-core");
const coreFiles = [
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-lstm.wasm",
];

await mkdir(target, { recursive: true });
await cp(worker, path.join(root, "public/ocr/worker.min.js"));
for (const filename of coreFiles) {
  await cp(path.join(core, filename), path.join(target, filename));
}

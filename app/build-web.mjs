// Builds www/ for the Android app from the shared page in ../src/kardly.html.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync } from "node:fs";
import { build } from "esbuild";
import { gunzipSync } from "node:zlib";

const here = new URL(".", import.meta.url).pathname;
const www = here + "www/";
rmSync(www, { recursive: true, force: true });
mkdirSync(www + "vendor/tesseract/core", { recursive: true });
mkdirSync(www + "vendor/tesseract/lang", { recursive: true });

// 1. Native bridge bundle (defines window.KardlyNative before the page script runs)
await build({
  entryPoints: [here + "native/native.js"], bundle: true, minify: true, format: "iife",
  target: ["chrome100"], outfile: www + "native.js", logLevel: "warning",
});

// 2. Offline libraries: OpenCV, Tesseract (worker, wasm core, English data), fonts
const nm = here + "node_modules/";
cpSync(nm + "@techstark/opencv-js/dist/opencv.js", www + "vendor/opencv.js");
cpSync(nm + "tesseract.js/dist/tesseract.min.js", www + "vendor/tesseract/tesseract.min.js");
cpSync(nm + "tesseract.js/dist/worker.min.js", www + "vendor/tesseract/worker.min.js");
for (const f of readdirSync(nm + "tesseract.js-core")) {
  // the backup OCR engine: one self-contained build per CPU feature level
  if (/^tesseract-core.*lstm\.wasm\.js$/.test(f)) cpSync(nm + "tesseract.js-core/" + f, www + "vendor/tesseract/core/" + f);
}
// Android's packager un-gzips *.gz assets, so ship the language data already uncompressed.
writeFileSync(www + "vendor/tesseract/lang/eng.traineddata", gunzipSync(readFileSync(nm + "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz")));
cpSync(here + "assets/fonts", www + "fonts", { recursive: true, filter: s => !s.endsWith("google.css") });

// 3. Page: drop web-only font links, add local fonts + the bridge, wrap in a document
let page = readFileSync(here + "../src/kardly.html", "utf8");
page = page.split("\n").filter(l => !l.includes("data-web-only")).join("\n");
const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0A1A3D">
<meta name="color-scheme" content="dark light">
<link rel="stylesheet" href="fonts/fonts.css">
<script src="native.js"></script>
</head>
<body>
`;
writeFileSync(www + "index.html", head + page + "\n</body>\n</html>\n");
console.log("www built");

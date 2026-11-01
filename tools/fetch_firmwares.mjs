// Fetch the firmwares in web/firmwares.json into reference/firmwares/ for fm1-live --fw:
// <id>.fwsc (the package as published), <id>.app.bin (its app) and <id>.xip.bin
// (the app behind 0x120 bytes of padding, loaded at 0x02000120).
//
// Usage:
//   node tools/fetch_firmwares.mjs [id ...]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { appFromPackage, fetchPackage } =
  await import(new URL("../web/fwsc.js", import.meta.url));

// Resolve repo root in a cross-platform way
const root = fileURLToPath(new URL("..", import.meta.url));

const cat = JSON.parse(
  readFileSync(path.join(root, "web", "firmwares.json"), "utf8")
);

const want = new Set(process.argv.slice(2));

mkdirSync(
  path.join(root, "reference", "firmwares"),
  { recursive: true }
);

// A site that is busy (429, 5xx) or drops the connection gets three more tries.
// What failed is reported, as the download then may not be the catalog's own
// package (fetchPackage falls back).

const failed = [];

async function patient(url, opts) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, opts);

      if (
        r.ok ||
        (r.status !== 429 && r.status < 500) ||
        i === 3
      ) {
        if (!r.ok) {
          failed.push(`${url}: ${r.status}`);
        }

        return r;
      }
    } catch (e) {
      if (i === 3) {
        failed.push(`${url}: ${e.message}`);
        throw e;
      }
    }

    await new Promise((ok) =>
      setTimeout(ok, 2000 << i)
    );
  }
}

for (const f of cat.firmwares) {
  if (want.size && !want.has(f.id)) {
    continue;
  }

  if (f.byo) {
    // M-VAVE stock firmware:
    // fm1-live --fwsc FM-1.fwsc
    continue;
  }

  try {
    failed.length = 0;

    const { bytes, url } = await fetchPackage(f, patient);

    const app = appFromPackage(bytes);

    const out = path.join(
      root,
      "reference",
      "firmwares",
      f.id
    );

    writeFileSync(out + ".fwsc", bytes);
    writeFileSync(out + ".app.bin", app);

    const xip = new Uint8Array(0x120 + app.length);
    xip.set(app, 0x120);

    writeFileSync(out + ".xip.bin", xip);

    console.log(
      `${f.id.padEnd(13)} ${url
        .replace(/\/$/, "")
        .split("/")
        .pop()
        .padEnd(36)} app ${app.length} bytes`
    );

    for (const why of failed) {
      console.log(`${"".padEnd(13)} (${why})`);
    }
  } catch (e) {
    console.log(
      `${f.id.padEnd(13)} FAILED ${e.message}`
    );
  }
}
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const m = (f) => path.join(here, "mocks", f);
const map = { "./platform": m("platform.ts"), "./store": m("store.ts"), "./attachments": m("attachments.ts"), "idb-keyval": m("idb.ts"), react: m("react.ts") };
await build({
  absWorkingDir: here, entryPoints: ["entry.ts"], bundle: true, format: "esm", platform: "node", outfile: "bundle.mjs", external: ["yjs"],
  plugins: [{ name: "mocks", setup(b) { b.onResolve({ filter: /^(\.\/platform|\.\/store|\.\/attachments|idb-keyval|react)$/ }, (a) => ({ path: map[a.path] })); } }],
});

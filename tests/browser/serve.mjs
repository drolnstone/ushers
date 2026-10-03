/* The apps and the real Worker in one local process, for trying the pages
   in a browser. Not part of the release.

     node tests/browser/serve.mjs            http://localhost:8787
*/
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorker, makeEnv } from "../lib/worker.mjs";

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".png": "image/png", ".txt": "text/plain" };

export async function start(port) {
  const { mod } = await loadWorker(ROOT);
  const env = makeEnv(ROOT);
  const ctx = { waitUntil() {} };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = await mod.default.fetch(new Request("http://localhost" + req.url, {
        method: req.method, headers: req.headers, body: req.method === "POST" ? Buffer.concat(chunks) : undefined }), env, ctx);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    let p = join(ROOT, decodeURIComponent(url.pathname));
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
    if (url.pathname.endsWith("config.js")) {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end('window.USHERS_CONFIG = { api: "", appName: "Ushers (local)", refreshSeconds: 30 };');
      return;
    }
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  await new Promise((ok) => server.listen(port, ok));
  return { server, env, mod };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await start(Number(process.env.PORT) || 8787);
  console.log("http://localhost:" + (Number(process.env.PORT) || 8787));
}

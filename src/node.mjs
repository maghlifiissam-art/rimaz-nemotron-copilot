import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { handle } from "./handler.mjs";
createServer(async (req, res) => {
  if (req.url === "/" || req.url.startsWith("/web")) {
    try { res.writeHead(200, { "content-type": "text/html" }); return res.end(await readFile(new URL("../web/index.html", import.meta.url))); } catch { res.writeHead(404); return res.end(); }
  }
  const chunks = []; for await (const c of req) chunks.push(c);
  const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
  const out = await handle(request, process.env);
  res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(Buffer.from(await out.arrayBuffer()));
}).listen(8788, "127.0.0.1", () => console.log("Copilot on http://127.0.0.1:8788"));

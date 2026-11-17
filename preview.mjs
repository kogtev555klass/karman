import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const files = new Map([
  ["index.html", "text/html; charset=utf-8"],
  ["styles.css", "text/css; charset=utf-8"],
  ["app.js", "text/javascript; charset=utf-8"],
  ["ledger.js", "text/javascript; charset=utf-8"],
  ["sw.js", "text/javascript; charset=utf-8"],
  ["manifest.webmanifest", "application/manifest+json"],
  ["icon-192.png", "image/png"],
  ["icon-512.png", "image/png"],
  ["apple-touch-icon.png", "image/png"],
]);

const base = "/karman/";
const port = Number(process.argv[2] ?? 4173);
const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url, "http://localhost");
  if (pathname === "/" || pathname === "/karman") {
    response.writeHead(302, { Location: base }).end();
    return;
  }

  const filename = pathname === base ? "index.html" : pathname.slice(base.length);
  const contentType = files.get(filename);
  if (!pathname.startsWith(base) || !contentType) {
    response.writeHead(404).end();
    return;
  }

  try {
    const content = await readFile(new URL(filename, import.meta.url));
    response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
    response.end(content);
  } catch {
    response.writeHead(500).end();
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Карман доступен на http://127.0.0.1:${server.address().port}${base}`);
});

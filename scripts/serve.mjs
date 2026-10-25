#!/usr/bin/env node
/* ==========================================================================
   Local static server for development.

   The site renders content/*.json entirely in the browser, so this server
   only serves files. There is no save API, build API or file watcher.

   No dependencies. Run with `npm run dev` (or `npm run preview`).
   ========================================================================== */

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, stat } from "node:fs/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 4173);

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".txt", "text/plain; charset=utf-8"],
  [".md", "text/plain; charset=utf-8"],
]);

const color = (code) => (process.stdout.isTTY ? `\u001b[${code}m` : "");
const dim = color("2");
const cyan = color("36");
const green = color("32");
const red = color("31");
const reset = color("0");

function resolveStaticPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  if (decoded.endsWith("/")) decoded += "index.html";

  const relative = decoded.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relative);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) return null;
  return filePath;
}

async function serveStatic(req, res, pathname) {
  const filePath = resolveStaticPath(pathname);
  if (!filePath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("403 Forbidden");
    return;
  }

  let info;
  try {
    info = await stat(filePath);
  } catch {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><title>404</title>
<body style="font-family:system-ui;padding:40px;background:#f5f5f5;color:#333">
<h1>404 Not Found</h1>
<p><code>${pathname.replaceAll("<", "&lt;")}</code> は見つかりません。</p>
<p><a href="/">記事へ戻る</a> ・ <a href="/guide.html">使い方</a></p>`);
    return;
  }

  if (info.isDirectory()) {
    res.writeHead(301, { Location: `${pathname.replace(/\/?$/, "/")}index.html` });
    res.end();
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME.get(ext) || "application/octet-stream";
  const cache = ext === ".html" || ext === ".json" ? "no-store" : "no-cache";

  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": info.size,
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  try {
    res.end(await readFile(filePath));
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("500 Internal Server Error");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }

  await serveStatic(req, res, url.pathname === "/" ? "/index.html" : url.pathname);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`${red}ポート ${PORT} は使用中です。${reset} PORT=4174 npm run dev のように変更してください。`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

server.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log("");
  console.log(`${cyan}  うちのこ百科事典${reset} ${dim}— local server${reset}`);
  console.log(`  ${green}→${reset} 記事      ${base}/`);
  console.log(`  ${green}→${reset} 使い方    ${base}/guide.html`);
  console.log(`  ${dim}記事はブラウザで content/*.json から描画されます。Ctrl+C で停止。${reset}`);
  console.log("");
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1200).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

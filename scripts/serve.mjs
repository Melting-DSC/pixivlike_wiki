#!/usr/bin/env node
/* ==========================================================================
   Local development server for the parody encyclopedia.

   - Serves the generated site and the editor.
   - Watches content/*.json and rebuilds index.html.
   - POST /api/save  … validates + writes the three content files, then builds.
   - POST /api/build … rebuilds without touching the content files.

   No dependencies. Run with `npm run dev`.
   ========================================================================== */

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { watch } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = path.join(ROOT, "content");
const BUILD_SCRIPT = path.join(ROOT, "scripts", "build.mjs");
const args = new Set(process.argv.slice(2));
const WATCH_ENABLED = !args.has("--no-watch");
const PORT = Number(process.env.PORT || 4173);
const MAX_BODY = 5 * 1024 * 1024;

const CONTENT_FILES = {
  site: path.join(CONTENT_DIR, "site.json"),
  article: path.join(CONTENT_DIR, "article.json"),
  categories: path.join(CONTENT_DIR, "categories.json"),
};

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
const yellow = color("33");
const reset = color("0");

let building = false;
let queuedBuild = false;
let suppressWatchUntil = 0;

function log(message) {
  console.log(`${dim}[${new Date().toLocaleTimeString("ja-JP")}]${reset} ${message}`);
}

function runBuild() {
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(
      process.execPath,
      [BUILD_SCRIPT],
      { cwd: ROOT, timeout: 20_000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error?.code ?? 0,
          ms: Date.now() - started,
          stdout: String(stdout || "").trim(),
          stderr: String(stderr || "").trim(),
        });
      },
    );
  });
}

async function rebuild(reason = "手動") {
  if (building) {
    queuedBuild = true;
    return null;
  }
  building = true;
  const result = await runBuild();
  building = false;

  if (result.ok) {
    log(`${green}✓${reset} ビルド完了 ${dim}(${reason}, ${result.ms}ms)${reset}`);
  } else {
    log(`${red}✗${reset} ビルド失敗 ${dim}(${reason})${reset}`);
    if (result.stderr) console.error(result.stderr);
  }

  if (queuedBuild) {
    queuedBuild = false;
    setTimeout(() => rebuild("連続変更"), 80);
  }
  return result;
}

/* --------------------------------------------------------------------------
   Minimal JSON body reader
   -------------------------------------------------------------------------- */

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    const type = req.headers["content-type"] || "";
    if (!type.includes("application/json")) {
      reject(Object.assign(new Error("Content-Type は application/json を指定してください。"), { status: 415 }));
      return;
    }

    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("リクエストが大きすぎます。"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("JSON を解析できませんでした。"), { status: 400 }));
      }
    });
    req.on("error", (error) => reject(Object.assign(error, { status: 400 })));
  });
}

function sendJSON(res, status, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

/* --------------------------------------------------------------------------
   Save / build API
   -------------------------------------------------------------------------- */

let saveChain = Promise.resolve();

function queueSave(task) {
  const run = saveChain.then(task, task);
  saveChain = run.catch(() => {});
  return run;
}

async function saveContent(payload) {
  if (!payload || typeof payload !== "object") {
    throw Object.assign(new Error("保存するデータがありません。"), { status: 400 });
  }

  for (const key of Object.keys(CONTENT_FILES)) {
    if (!payload[key] || typeof payload[key] !== "object" || Array.isArray(payload[key])) {
      throw Object.assign(new Error(`${key} のデータが不正です。`), { status: 400 });
    }
  }

  const backups = new Map();
  for (const [key, file] of Object.entries(CONTENT_FILES)) {
    backups.set(key, await readFile(file, "utf8"));
  }

  suppressWatchUntil = Date.now() + 1500;

  try {
    for (const [key, file] of Object.entries(CONTENT_FILES)) {
      await writeFile(file, `${JSON.stringify(payload[key], null, 2)}\n`, "utf8");
    }

    const result = await rebuild("エディタから保存");
    if (!result?.ok) {
      throw Object.assign(new Error(result?.stderr || "ビルドに失敗しました。"), {
        status: 422,
        build: result,
      });
    }
    return result;
  } catch (error) {
    // Roll back all three files so a failed save can never leave broken content.
    for (const [key, file] of Object.entries(CONTENT_FILES)) {
      await writeFile(file, backups.get(key), "utf8").catch(() => {});
    }
    await runBuild().catch(() => {});
    throw error;
  }
}

/* --------------------------------------------------------------------------
   Static files
   -------------------------------------------------------------------------- */

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
<p><a href="/">記事へ戻る</a> ・ <a href="/editor.html">エディタ</a></p>`);
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
    const body = await readFile(filePath);
    res.end(body);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("500 Internal Server Error");
  }
}

/* --------------------------------------------------------------------------
   Server
   -------------------------------------------------------------------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const { pathname } = url;

  try {
    if (pathname === "/api/health") {
      sendJSON(res, 200, { ok: true, watch: WATCH_ENABLED, root: ROOT });
      return;
    }

    if (pathname === "/api/build" && req.method === "POST") {
      const result = await rebuild("API");
      sendJSON(res, result?.ok ? 200 : 422, { ok: Boolean(result?.ok), build: result });
      return;
    }

    if (pathname === "/api/save" && req.method === "POST") {
      const payload = await readJSONBody(req);
      const result = await queueSave(() => saveContent(payload));
      sendJSON(res, 200, { ok: true, build: result });
      return;
    }

    if (pathname.startsWith("/api/")) {
      sendJSON(res, 404, { ok: false, error: "API が見つかりません。" });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }

    await serveStatic(req, res, pathname === "/" ? "/index.html" : pathname);
  } catch (error) {
    if (!res.headersSent) {
      sendJSON(res, error?.status || 500, {
        ok: false,
        error: error?.message || "サーバーエラー",
        build: error?.build || undefined,
      });
    } else {
      res.end();
    }
  }
});

let watcher = null;
if (WATCH_ENABLED) {
  let timer = 0;
  watcher = watch(CONTENT_DIR, { persistent: true }, (event, filename) => {
    if (!filename || !filename.endsWith(".json")) return;
    if (Date.now() < suppressWatchUntil) return;
    clearTimeout(timer);
    timer = setTimeout(() => rebuild(`content/${filename} が変更`), 220);
  });
}

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
  console.log(`  ${green}→${reset} エディタ  ${base}/editor.html`);
  console.log(
    `  ${dim}${WATCH_ENABLED ? "content/ を監視して自動ビルドします。" : "自動ビルドは無効です。"} Ctrl+C で停止。${reset}`,
  );
  console.log("");
});

function shutdown() {
  log("サーバーを停止します。");
  try {
    watcher?.close();
  } catch {
    /* noop */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1200).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");

// Finds an installed package directory, walking up node_modules the way Node does,
// so this works both in the repo and when installed through npx.
function packageDir(name) {
  for (let dir = path.join(here, ".."); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) throw new Error(`Missing dependency: ${name}`);
  }
}

const mounts = {
  "/vendor/marked/": path.join(packageDir("marked"), "lib"),
  "/vendor/hljs/": packageDir("@highlightjs/cdn-assets"),
  "/vendor/plex-sans/": packageDir("@fontsource/ibm-plex-sans"),
  "/vendor/plex-mono/": packageDir("@fontsource/ibm-plex-mono"),
  "/": publicDir,
};

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
  ".png": "image/png",
};

function serveStatic(req, res, pathname) {
  if (pathname === "/") pathname = "/index.html";
  for (const [prefix, root] of Object.entries(mounts)) {
    if (!pathname.startsWith(prefix)) continue;
    const file = path.normalize(path.join(root, decodeURIComponent(pathname.slice(prefix.length))));
    if (!file.startsWith(root)) break;
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) return send(res, 404, "Not found");
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
        "Content-Length": stat.size,
        "Cache-Control": prefix === "/" ? "no-cache" : "public, max-age=31536000, immutable",
      });
      fs.createReadStream(file).pipe(res);
    });
    return;
  }
  send(res, 404, "Not found");
}

function send(res, status, body) {
  const json = typeof body !== "string";
  res.writeHead(status, { "Content-Type": json ? "application/json" : "text/plain; charset=utf-8" });
  res.end(json ? JSON.stringify(body) : body);
}

function readJson(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("Request too large"), { status: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

// Blocks DNS-rebinding: a malicious site pointing its own domain at 127.0.0.1
// would send its domain in the Host header, so only accept local names
// (or anything, when the user explicitly exposed the server to the network).
function isAllowedHost(hostHeader, bindHost) {
  if (bindHost === "0.0.0.0" || bindHost === "::") return true;
  const name = (hostHeader ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  return name === "localhost" || name === "127.0.0.1" || name === "::1" || name === bindHost;
}

export function startServer({ port, host, state }) {
  const server = http.createServer(async (req, res) => {
    if (!isAllowedHost(req.headers.host, host)) return send(res, 403, "Forbidden host");
    const { pathname } = new URL(req.url, "http://localhost");

    if (pathname === "/api/status" && req.method === "GET") {
      return send(res, 200, {
        status: state.status,
        error: state.error ?? null,
        model: state.engine?.info ?? state.pendingInfo ?? null,
      });
    }

    if (pathname === "/api/chat" && req.method === "POST") {
      // Requiring JSON forces a CORS preflight, which this server never approves,
      // so other websites can't drive the model through the visitor's browser.
      if (!req.headers["content-type"]?.startsWith("application/json")) {
        return send(res, 415, { error: "Expected application/json." });
      }
      if (state.status !== "ready") return send(res, 503, { error: "The model is still loading." });

      let body;
      try { body = await readJson(req); }
      catch (err) { return send(res, err.status ?? 400, { error: err.message }); }

      const messages = Array.isArray(body.messages) ? body.messages : [];
      if (!messages.length || messages.at(-1).role !== "user") {
        return send(res, 400, { error: "The last message must be from the user." });
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const emit = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

      const controller = new AbortController();
      res.on("close", () => controller.abort());

      const started = performance.now();
      let firstText = null;
      try {
        const { tokens } = await state.engine.generate({
          messages: messages.map((m) => ({ role: m.role, content: String(m.content ?? "") })),
          system: body.system,
          temperature: Number(body.temperature ?? 0.7),
          topP: Number(body.topP ?? 0.9),
          maxTokens: Number(body.maxTokens ?? 0),
          signal: controller.signal,
          onThought: (text) => emit({ type: "thought", text }),
          onText: (text) => {
            firstText ??= performance.now();
            emit({ type: "text", text });
          },
        });
        const seconds = (performance.now() - started) / 1000;
        emit({
          type: "done",
          tokens,
          seconds,
          tokensPerSecond: seconds > 0 ? tokens / seconds : 0,
          thoughtSeconds: firstText ? (firstText - started) / 1000 : null,
          stopped: controller.signal.aborted,
        });
      } catch (err) {
        emit({ type: "error", error: err.message });
      }
      return res.end();
    }

    if (req.method === "GET") return serveStatic(req, res, pathname);
    send(res, 405, "Method not allowed");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

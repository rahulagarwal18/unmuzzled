#!/usr/bin/env node
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { startServer } from "../src/server.js";
import { createEngine, createMockEngine, describeModelFile } from "../src/engine.js";
import {
  CATALOG, DEFAULT_MODEL, MODELS_DIR, hasPartialDownload, installedPath, machineInfo, startModelDownload,
} from "../src/models.js";

const { values: args } = parseArgs({
  options: {
    model: { type: "string", short: "m" },
    port: { type: "string", short: "p", default: "4317" },
    host: { type: "string", default: "127.0.0.1" },
    ctx: { type: "string", default: "8192" },
    gpu: { type: "string", default: "auto" },
    "no-open": { type: "boolean", default: false },
    mock: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (args.help) {
  console.log(`
  unmuzzled — private, offline chat for local GGUF models

  Usage
    npx unmuzzled [options]

  Options
    -m, --model <path|url>  GGUF file on disk, or a URL to download it from.
                            Without it, the interface opens and offers to
                            download DeepSeek V4 Pro · Qwen3.5 9B (5.63 GB)
    -p, --port <number>     Port for the web interface        (default: 4317)
        --host <address>    Address to bind                   (default: 127.0.0.1)
        --ctx <tokens>      Maximum context size              (default: 8192)
        --gpu <backend>     auto | cuda | vulkan | metal | false (default: auto)
        --no-open           Don't open the browser
        --mock              Run the interface with a fake model
    -h, --help              Show this message

  Models are stored in ${MODELS_DIR}
`);
  process.exit(0);
}

const dim = (s) => `\x1b[2m${s}\x1b[22m`;
const bold = (s) => `\x1b[1m${s}\x1b[22m`;
const green = (s) => `\x1b[32m${s}\x1b[39m`;
const red = (s) => `\x1b[31m${s}\x1b[39m`;

function openBrowser(url) {
  const [cmd, cmdArgs] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]]
    : ["xdg-open", [url]];
  spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

async function resolveModel(source) {
  if (!/^(https?:|hf:)/i.test(source)) {
    const file = path.resolve(source);
    if (!fs.existsSync(file)) throw new Error(`Model file not found: ${file}`);
    return file;
  }
  // Already downloaded? Use it without touching the network.
  if (/^https?:/i.test(source)) {
    const local = path.join(MODELS_DIR, decodeURIComponent(path.posix.basename(new URL(source).pathname)));
    if (fs.existsSync(local)) return local;
  }
  fs.mkdirSync(MODELS_DIR, { recursive: true });

  if (/^https?:/i.test(source)) {
    const size = await fetch(source, { method: "HEAD", redirect: "follow" })
      .then((r) => Number(r.headers.get("content-length")) || null)
      .catch(() => null);
    const gb = (n) => `${(n / 1e9).toFixed(2)} GB`;

    console.log(`  ${bold("Downloading")} the model. This only happens once.`);
    console.log(dim(`  ${path.posix.basename(new URL(source).pathname)}${size ? ` · ${gb(size)}` : ""}`));
    console.log(dim(`  Saving to ${MODELS_DIR}`));
    console.log(dim(`  You can stop with Ctrl+C and run the command again to resume.\n`));

    const free = fs.statfsSync?.(MODELS_DIR);
    if (size && free && free.bavail * free.bsize < size * 1.05) {
      throw new Error(`Not enough disk space: the model needs ${gb(size)}, but only ${gb(free.bavail * free.bsize)} is free on that drive.`);
    }
  }

  const { resolveModelFile } = await import("node-llama-cpp");
  return resolveModelFile(source, { directory: MODELS_DIR, cli: true });
}

const port = Number(args.port);
const url = `http://${args.host === "0.0.0.0" ? "localhost" : args.host}:${port}`;

// status: setup → downloading → loading → ready (or error)
const state = {
  status: "loading",
  engine: null,
  error: null,
  pendingInfo: null,
  download: null,
  catalog: CATALOG,
  setup: null,
};

async function loadModel(modelPath) {
  state.status = "loading";
  state.error = null;
  state.pendingInfo = describeModelFile(modelPath);
  console.log(`  ${dim("○")} Loading     ${path.basename(modelPath)}`);
  const startedAt = Date.now();
  try {
    state.engine = await createEngine({ modelPath, contextSize: Number(args.ctx), gpu: args.gpu });
  } catch (err) {
    state.status = "error";
    state.error = err.message;
    console.error(`  ${red("●")} ${err.message}`);
    return;
  }
  const { backend, contextSize } = state.engine.info;
  state.status = "ready";
  console.log(`  ${green("●")} Ready       ${dim(`${backend} · ${contextSize} ctx · ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)}`);
}

function enterSetup(error = null) {
  state.status = "setup";
  state.error = error;
  state.setup = {
    machine: machineInfo(),
    resumable: hasPartialDownload(DEFAULT_MODEL),
  };
  // Warm up the downloader so clicking Download starts immediately.
  import("node-llama-cpp").catch(() => {});
}

let activeDownload = null;
let pauseRequested = false;
let lastLoggedPct = -1;

// Called from the interface when the user clicks Download.
const actions = {
  async download() {
    if (state.status !== "setup") return;
    const entry = DEFAULT_MODEL;
    state.status = "downloading";
    state.error = null;
    state.download = { downloaded: 0, total: entry.sizeBytes, speed: 0, eta: null, pausing: false };
    pauseRequested = false;
    lastLoggedPct = -1;
    console.log(`  ${dim("↓")} Download    ${entry.file} ${dim(`· ${(entry.sizeBytes / 1e9).toFixed(2)} GB → ${MODELS_DIR}`)}`);

    try {
      activeDownload = await startModelDownload(entry, (p) => {
        state.download = { ...p, pausing: pauseRequested };
        const pct = Math.floor((p.downloaded / p.total) * 100);
        if (pct >= lastLoggedPct + 10) {
          lastLoggedPct = pct - (pct % 10);
          console.log(dim(`              ${String(pct).padStart(3)}%  ${(p.downloaded / 1e9).toFixed(2)} / ${(p.total / 1e9).toFixed(2)} GB`));
        }
      });
      // Pause may have been clicked while the download was still connecting.
      if (pauseRequested) await activeDownload.cancel();
      await activeDownload.done;
      activeDownload = null;
      state.download = null;

      // A cancelled download also resolves, so check the file is really complete.
      const modelPath = installedPath(entry);
      if (!modelPath) {
        enterSetup(pauseRequested ? null : "The download stopped before it finished. Click Resume to continue.");
        console.log(`  ${dim("‖")} Paused      ${dim("click Resume in the interface to continue")}`);
        return;
      }
      console.log(`  ${green("●")} Downloaded  ${dim(modelPath)}`);
      await loadModel(modelPath);
    } catch (err) {
      activeDownload = null;
      state.download = null;
      enterSetup(`Download failed: ${err.message}. Click Resume to try again.`);
      console.error(`  ${red("●")} Download failed: ${err.message}`);
    }
  },

  async pause() {
    if (state.status !== "downloading" || pauseRequested) return;
    pauseRequested = true;
    if (state.download) state.download.pausing = true;
    await activeDownload?.cancel();
  },
};

console.log(`\n  ${bold("unmuzzled")} ${dim("· private, offline chat")}\n`);

try {
  // An explicit --model is loaded (or downloaded) straight away; otherwise the
  // interface opens first and lets the user choose to download the default model.
  let modelPath = null;
  if (args.mock) {
    // no model
  } else if (args.model) {
    modelPath = await resolveModel(args.model);
  } else {
    modelPath = installedPath(DEFAULT_MODEL);
    if (!modelPath) enterSetup();
  }

  await startServer({ port, host: args.host, state, actions });
  console.log(`  ${green("●")} Interface   ${bold(url)}`);
  if (!["127.0.0.1", "localhost", "::1"].includes(args.host)) {
    console.log(`  ${red("!")} Exposed     ${dim(`anyone on your network can use this model — there is no login`)}`);
  }
  if (!args["no-open"]) openBrowser(url);

  if (args.mock) {
    state.engine = createMockEngine();
    state.status = "ready";
  } else if (modelPath) {
    await loadModel(modelPath);
  } else {
    console.log(`  ${dim("○")} Setup       ${dim("no model yet — choose one in the browser to download it")}`);
  }
  console.log(dim(`\n  Press Ctrl+C to stop.\n`));
} catch (err) {
  if (err.code === "EADDRINUSE") {
    console.error(`  ${red("●")} Port ${port} is already in use. Try --port ${port + 1}.`);
    process.exit(1);
  }
  // If the server is already up, it stays running so the interface can show the error.
  state.status = "error";
  state.error = err.message;
  process.exitCode = 1;
  console.error(`  ${red("●")} ${err.message}`);
}

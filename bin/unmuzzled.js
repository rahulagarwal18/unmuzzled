#!/usr/bin/env node
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { startServer } from "../src/server.js";
import { createEngine, createMockEngine, describeModelFile } from "../src/engine.js";

const DEFAULT_MODEL =
  "https://huggingface.co/mradermacher/DeepSeek-V4-Pro-Qwen3.5-9B-UNCENSORED-heretic-i1-GGUF" +
  "/resolve/main/DeepSeek-V4-Pro-Qwen3.5-9B-UNCENSORED-heretic.i1-Q4_K_M.gguf";
const MODELS_DIR = path.join(os.homedir(), ".unmuzzled", "models");

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
    -m, --model <path|url>  GGUF file on disk, or a URL to download it from
                            (default: DeepSeek V4 Pro · Qwen3.5 9B, Q4_K_M)
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
  const { resolveModelFile } = await import("node-llama-cpp");
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  return resolveModelFile(source, { directory: MODELS_DIR, cli: true });
}

const state = { status: "loading", engine: null, error: null, pendingInfo: null };
const port = Number(args.port);
const url = `http://${args.host === "0.0.0.0" ? "localhost" : args.host}:${port}`;

console.log(`\n  ${bold("unmuzzled")} ${dim("· private, offline chat")}\n`);

try {
  let modelPath = null;
  if (!args.mock) {
    modelPath = await resolveModel(args.model ?? DEFAULT_MODEL);
    state.pendingInfo = describeModelFile(modelPath);
  }

  await startServer({ port, host: args.host, state });
  console.log(`  ${green("●")} Interface   ${bold(url)}`);
  if (!["127.0.0.1", "localhost", "::1"].includes(args.host)) {
    console.log(`  ${red("!")} Exposed     ${dim(`anyone on your network can use this model — there is no login`)}`);
  }
  if (!args["no-open"]) openBrowser(url);

  if (args.mock) {
    state.engine = createMockEngine();
  } else {
    console.log(`  ${dim("○")} Loading     ${path.basename(modelPath)}`);
    const startedAt = Date.now();
    state.engine = await createEngine({ modelPath, contextSize: Number(args.ctx), gpu: args.gpu });
    const { backend, contextSize } = state.engine.info;
    console.log(`  ${green("●")} Ready       ${dim(`${backend} · ${contextSize} ctx · ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)}`);
  }
  state.status = "ready";
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

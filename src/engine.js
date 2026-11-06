import path from "node:path";
import fs from "node:fs";

// Pulls a readable name and quantisation out of a GGUF filename,
// e.g. "Foo-Qwen3.5-9B.i1-Q4_K_M.gguf" -> { name: "Foo Qwen3.5 9B", quant: "Q4_K_M" }
export function describeModelFile(filePath) {
  const base = path.basename(filePath).replace(/\.gguf$/i, "");
  const quantMatch = base.match(/[.-](?:i1-)?((?:IQ|Q|F|BF)\d[\w]*)$/i);
  const quant = quantMatch ? quantMatch[1].toUpperCase() : null;
  const stem = quantMatch ? base.slice(0, quantMatch.index) : base;
  const name = stem.replace(/\.i1$/i, "").replace(/[-_]+/g, " ").trim();
  const params = name.match(/\b(\d+(?:\.\d+)?B)\b/i)?.[1]?.toUpperCase() ?? null;
  let sizeBytes = null;
  try { sizeBytes = fs.statSync(filePath).size; } catch {}
  return { file: path.basename(filePath), name, quant, params, sizeBytes };
}

// Splits raw "<think>…</think>" output into thought / answer streams,
// for chat templates where node-llama-cpp doesn't segment thoughts itself.
function createThinkSplitter(onThought, onText) {
  let mode = "text";
  let buffer = "";
  const OPEN = "<think>";
  const CLOSE = "</think>";

  return (chunk) => {
    buffer += chunk;
    while (buffer.length > 0) {
      const tag = mode === "text" ? OPEN : CLOSE;
      const idx = buffer.indexOf(tag);
      if (idx !== -1) {
        if (idx > 0) (mode === "text" ? onText : onThought)(buffer.slice(0, idx));
        buffer = buffer.slice(idx + tag.length);
        mode = mode === "text" ? "thought" : "text";
        continue;
      }
      // Hold back anything that could be the start of a tag split across chunks.
      let keep = 0;
      for (let i = 1; i < tag.length; i++) {
        if (buffer.endsWith(tag.slice(0, i))) keep = i;
      }
      const emit = buffer.slice(0, buffer.length - keep);
      if (emit) (mode === "text" ? onText : onThought)(emit);
      buffer = buffer.slice(buffer.length - keep);
      break;
    }
  };
}

export async function createEngine({ modelPath, contextSize = 8192, gpu = "auto" }) {
  const { getLlama, LlamaChatSession } = await import("node-llama-cpp");

  const llama = await getLlama({ gpu: gpu === "false" ? false : gpu });
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext({
    contextSize: { min: 2048, max: contextSize },
  });
  const session = new LlamaChatSession({ contextSequence: context.getSequence() });
  let busy = false;

  const info = {
    ...describeModelFile(modelPath),
    backend: llama.gpu || "cpu",
    gpuLayers: model.gpuLayers,
    contextSize: context.contextSize,
    trainContextSize: model.trainContextSize,
  };

  async function generate({ messages, system, temperature, topP, maxTokens, signal, onThought, onText }) {
    if (busy) throw Object.assign(new Error("A response is already being generated."), { status: 409 });
    busy = true;
    try {
      const history = [];
      if (system?.trim()) history.push({ type: "system", text: system.trim() });
      for (const m of messages.slice(0, -1)) {
        history.push(m.role === "user"
          ? { type: "user", text: m.content }
          : { type: "model", response: [m.content] });
      }
      session.setChatHistory(history);

      const splitText = createThinkSplitter(onThought, onText);
      let tokens = 0;

      await session.prompt(messages.at(-1).content, {
        temperature,
        topP,
        maxTokens: maxTokens || undefined,
        signal,
        stopOnAbortSignal: true,
        onResponseChunk(chunk) {
          tokens += chunk.tokens?.length ?? 0;
          if (chunk.type === "segment" && chunk.segmentType === "thought") onThought(chunk.text);
          else if (chunk.type == null) splitText(chunk.text);
        },
      });
      return { tokens };
    } finally {
      busy = false;
    }
  }

  return { info, generate };
}

// A stand-in engine so the interface can be developed without loading a model.
export function createMockEngine() {
  const info = {
    file: "mock-model.gguf",
    name: "Mock model",
    quant: "Q4_K_M",
    params: "9B",
    sizeBytes: 5_629_111_584,
    backend: "mock",
    gpuLayers: 0,
    contextSize: 8192,
    trainContextSize: 262144,
  };

  const thought =
    "The user wants a quick overview. I'll keep it short, give one concrete example, " +
    "and finish with a small code sample so the formatting can be checked.";
  const answer = [
    "Here's a short answer with a bit of everything, so you can see how responses are laid out.",
    "",
    "## Why run models locally",
    "",
    "- **Privacy** — prompts and outputs never leave this machine.",
    "- **No rate limits** — the only limit is your hardware.",
    "- **Works offline** — on a plane, on a train, wherever.",
    "",
    "A quick example in Python:",
    "",
    "```python",
    "def tokens_per_second(tokens: int, seconds: float) -> float:",
    "    \"\"\"Throughput of a generation run.\"\"\"",
    "    return tokens / seconds if seconds else 0.0",
    "",
    "print(f\"{tokens_per_second(412, 81.3):.1f} tok/s\")",
    "```",
    "",
    "| Quant | Size | Quality |",
    "|---|---|---|",
    "| Q4_K_M | 5.6 GB | Good balance |",
    "| Q6_K | 7.4 GB | Near-lossless |",
    "",
    "Inline code like `llama-server --ctx 8192` works too.",
  ].join("\n");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pieces = (s) => s.match(/\s*\S+|\s+/g) ?? [];

  async function generate({ signal, onThought, onText }) {
    let tokens = 0;
    for (const p of pieces(thought)) {
      if (signal.aborted) return { tokens };
      onThought(p); tokens++; await sleep(18);
    }
    for (const p of pieces(answer)) {
      if (signal.aborted) return { tokens };
      onText(p); tokens++; await sleep(22);
    }
    return { tokens };
  }

  return { info, generate };
}

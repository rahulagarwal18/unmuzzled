import { initLlama, LlamaContext } from "llama.rn";
import type { Message, Settings } from "./storage";

let context: LlamaContext | null = null;
let loadedKey = "";

export type EngineInfo = { gpu: boolean; reasonNoGPU: string };

export async function loadModel(
  uri: string,
  settings: Pick<Settings, "useGpu" | "contextSize">,
  onProgress: (pct: number) => void,
): Promise<EngineInfo> {
  const key = `${uri}|${settings.useGpu}|${settings.contextSize}`;
  if (context && loadedKey === key) return { gpu: context.gpu, reasonNoGPU: context.reasonNoGPU };

  await unloadModel();
  context = await initLlama(
    {
      model: uri,
      n_ctx: settings.contextSize,
      n_gpu_layers: settings.useGpu ? 99 : 0,
      use_mlock: false,
    },
    onProgress,
  );
  loadedKey = key;
  return { gpu: context.gpu, reasonNoGPU: context.reasonNoGPU };
}

export async function unloadModel() {
  const c = context;
  context = null;
  loadedKey = "";
  await c?.release();
}

// Rough budget so long chats don't overflow the context window:
// keep the most recent messages that fit, assuming ~3.5 characters per token.
function fitHistory(messages: Message[], contextSize: number, reserve: number) {
  const budget = Math.max(512, contextSize - reserve) * 3.5;
  const kept: Message[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    used += messages[i].content.length + 16;
    if (used > budget && kept.length > 0) break;
    kept.unshift(messages[i]);
  }
  return kept;
}

export type StreamUpdate = { content: string; reasoning: string };

export async function generate(
  history: Message[],
  settings: Settings,
  onUpdate: (u: StreamUpdate) => void,
) {
  if (!context) throw new Error("The model isn't loaded.");

  const fitted = fitHistory(history, settings.contextSize, settings.maxTokens || 1024);
  const messages = [
    ...(settings.system.trim() ? [{ role: "system" as const, content: settings.system.trim() }] : []),
    ...fitted.map((m) => ({ role: m.role, content: m.content })),
  ];

  const started = Date.now();
  const result = await context.completion(
    {
      messages,
      n_predict: settings.maxTokens > 0 ? settings.maxTokens : -1,
      temperature: settings.temperature,
      top_p: 0.95,
      enable_thinking: settings.thinking,
      reasoning_format: "auto",
    },
    (data) => {
      // content / reasoning_content are the full parsed text so far, not deltas.
      onUpdate({ content: data.content ?? "", reasoning: data.reasoning_content ?? "" });
    },
  );

  const seconds = (Date.now() - started) / 1000;
  return {
    content: result.content ?? result.text,
    reasoning: result.reasoning_content ?? "",
    stats: {
      tokens: result.timings?.predicted_n ?? result.tokens_predicted,
      tokensPerSecond: result.timings?.predicted_per_second ?? 0,
      seconds,
      stopped: result.interrupted,
    },
  };
}

export async function stopGenerating() {
  await context?.stopCompletion();
}

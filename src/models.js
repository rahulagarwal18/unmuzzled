import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export const MODELS_DIR = path.join(os.homedir(), ".unmuzzled", "models");

// Models offered on the setup screen.
export const CATALOG = [
  {
    id: "deepseek-v4-pro-qwen3.5-9b-uncensored",
    name: "DeepSeek V4 Pro · Qwen3.5 9B",
    variant: "Uncensored (Heretic) · Q4_K_M",
    description:
      "A 9B reasoning model fine-tuned on DeepSeek-V4-Pro outputs, with refusal training removed. " +
      "Thinks before it answers.",
    file: "DeepSeek-V4-Pro-Qwen3.5-9B-UNCENSORED-heretic.i1-Q4_K_M.gguf",
    url:
      "https://huggingface.co/mradermacher/DeepSeek-V4-Pro-Qwen3.5-9B-UNCENSORED-heretic-i1-GGUF" +
      "/resolve/main/DeepSeek-V4-Pro-Qwen3.5-9B-UNCENSORED-heretic.i1-Q4_K_M.gguf",
    source: "https://huggingface.co/mradermacher/DeepSeek-V4-Pro-Qwen3.5-9B-UNCENSORED-heretic-i1-GGUF",
    sizeBytes: 5_629_111_584,
    memoryBytes: 8_000_000_000,
    license: "Apache-2.0",
  },
];

export const DEFAULT_MODEL = CATALOG[0];

const filePath = (entry) => path.join(MODELS_DIR, entry.file);

/** Path of a fully downloaded catalog model, or null. */
export function installedPath(entry) {
  try {
    const p = filePath(entry);
    return fs.statSync(p).size === entry.sizeBytes ? p : null;
  } catch {
    return null;
  }
}

/** True when an interrupted download left a partial file that can be resumed. */
export function hasPartialDownload(entry) {
  return fs.existsSync(`${filePath(entry)}.ipull`);
}

export function machineInfo() {
  let freeDisk = null;
  try {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    const s = fs.statfsSync(MODELS_DIR);
    freeDisk = s.bavail * s.bsize;
  } catch {}
  return { totalMemory: os.totalmem(), freeDisk, modelsDir: MODELS_DIR };
}

/**
 * Downloads a catalog model with progress and resume support.
 * Call `cancel()` to pause; the partial file is kept and the next download resumes it.
 */
export async function startModelDownload(entry, onProgress) {
  const { freeDisk } = machineInfo();
  if (freeDisk != null && !hasPartialDownload(entry) && freeDisk < entry.sizeBytes * 1.05) {
    throw new Error(
      `Not enough disk space: the model needs ${(entry.sizeBytes / 1e9).toFixed(1)} GB, ` +
      `but only ${(freeDisk / 1e9).toFixed(1)} GB is free.`,
    );
  }

  const { createModelDownloader } = await import("node-llama-cpp");
  const downloader = await createModelDownloader({
    modelUrl: entry.url,
    dirPath: MODELS_DIR,
    fileName: entry.file,
    showCliProgress: false,
    deleteTempFileOnCancel: false,
    onProgress: ({ totalSize, downloadedSize, averageSpeed, estimatedTimeLeft }) =>
      onProgress({ downloaded: downloadedSize, total: totalSize || entry.sizeBytes, speed: averageSpeed, eta: estimatedTimeLeft }),
  });

  return {
    done: downloader.download(),
    cancel: () => downloader.cancel({ deleteTempFile: false }),
  };
}

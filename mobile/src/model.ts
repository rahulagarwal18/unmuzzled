import { Directory, DownloadTask, File, Paths } from "expo-file-system";
import * as Device from "expo-device";
import { InstalledModel, store } from "./storage";

export const DEFAULT_MODEL = {
  name: "DeepSeek V4 Pro · Qwen3.5 9B",
  variant: "Uncensored (Heretic) · Q4_K_M",
  file: "DeepSeek-V4-Pro-Qwen3.5-9B-UNCENSORED-heretic.i1-Q4_K_M.gguf",
  url:
    "https://huggingface.co/mradermacher/DeepSeek-V4-Pro-Qwen3.5-9B-UNCENSORED-heretic-i1-GGUF" +
    "/resolve/main/DeepSeek-V4-Pro-Qwen3.5-9B-UNCENSORED-heretic.i1-Q4_K_M.gguf",
  sizeBytes: 5_629_111_584,
  // Weights plus a 4K context and runtime overhead.
  memoryBytes: 7_000_000_000,
};

const modelsDir = () => {
  const dir = new Directory(Paths.document, "models");
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
};

export const gb = (bytes: number) => `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`;

export function deviceInfo() {
  return {
    totalMemory: Device.totalMemory ?? null,
    freeDisk: Paths.availableDiskSpace,
    model: Device.modelName,
  };
}

// Android reserves 3–4 GB for itself, so the 9B model needs a phone with ~10 GB+.
export function memoryVerdict(totalMemory: number | null): "good" | "tight" | "insufficient" | "unknown" {
  if (!totalMemory) return "unknown";
  if (totalMemory >= 11e9) return "good";
  if (totalMemory >= 9e9) return "tight";
  return "insufficient";
}

/** Returns the installed model if its file is still on disk. */
export async function getInstalledModel(): Promise<InstalledModel | null> {
  const m = await store.loadModel();
  if (!m) return null;
  const f = new File(m.uri);
  if (!f.exists || (f.size ?? 0) !== m.sizeBytes) {
    await store.saveModel(null);
    return null;
  }
  return m;
}

export async function deleteInstalledModel() {
  const m = await store.loadModel();
  if (m) {
    try { new File(m.uri).delete(); } catch {}
  }
  await store.saveModel(null);
}

export type DownloadProgress = { written: number; total: number };

/**
 * Downloads the default model with pause/resume. Pausing saves the
 * resume state, so a download can continue after the app is closed.
 */
export class ModelDownload {
  private task: DownloadTask | null = null;
  constructor(private onProgress: (p: DownloadProgress) => void) {}

  static async hasPausedDownload() {
    return (await store.loadDownload()) != null;
  }

  async start(): Promise<InstalledModel | null> {
    const saved = await store.loadDownload();
    const options = {
      onProgress: ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) =>
        this.onProgress({ written: bytesWritten, total: totalBytes > 0 ? totalBytes : DEFAULT_MODEL.sizeBytes }),
    };

    let file: File | null;
    if (saved) {
      this.task = DownloadTask.fromSavable(saved as never, options);
      file = await this.task.resumeAsync();
    } else {
      const dest = new File(modelsDir(), DEFAULT_MODEL.file);
      if (dest.exists) dest.delete();
      this.task = File.createDownloadTask(DEFAULT_MODEL.url, dest, options);
      file = await this.task.downloadAsync();
    }

    // null means the task was paused rather than finished.
    if (!file) return null;
    await store.saveDownload(null);
    const installed: InstalledModel = {
      uri: file.uri,
      name: DEFAULT_MODEL.name,
      file: DEFAULT_MODEL.file,
      sizeBytes: file.size ?? DEFAULT_MODEL.sizeBytes,
    };
    await store.saveModel(installed);
    return installed;
  }

  async pause() {
    if (!this.task || this.task.state !== "active") return;
    await this.task.pauseAsync();
    await store.saveDownload(this.task.savable());
  }

  async cancel() {
    this.task?.cancel();
    this.task = null;
    await store.saveDownload(null);
    const partial = new File(modelsDir(), DEFAULT_MODEL.file);
    try { if (partial.exists) partial.delete(); } catch {}
  }
}

/** Lets the user pick a .gguf already on the phone and copies it into app storage. */
export async function importModelFile(onCopying: (name: string, size: number) => void): Promise<InstalledModel | null> {
  const picked = await File.pickFileAsync();
  if (picked.canceled) return null;
  const source = picked.result;
  const name = decodeURIComponent(source.name || "model.gguf");
  if (!/\.gguf$/i.test(name)) throw new Error("That isn't a .gguf model file.");

  const size = source.size ?? 0;
  if (size && size * 1.02 > Paths.availableDiskSpace) {
    throw new Error(`Not enough storage: the model needs ${gb(size)}, but only ${gb(Paths.availableDiskSpace)} is free.`);
  }

  onCopying(name, size);
  const dest = new File(modelsDir(), name);
  if (dest.exists) dest.delete();
  await source.copy(dest);

  const installed: InstalledModel = {
    uri: dest.uri,
    name: name.replace(/\.gguf$/i, "").replace(/[-_.]+/g, " "),
    file: name,
    sizeBytes: dest.size ?? size,
  };
  if (name === DEFAULT_MODEL.file) installed.name = DEFAULT_MODEL.name;
  await store.saveModel(installed);
  return installed;
}

import AsyncStorage from "@react-native-async-storage/async-storage";

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  reasoningSeconds?: number | null;
  stats?: { tokens: number; tokensPerSecond: number; seconds: number; stopped: boolean } | null;
  error?: string | null;
};

export type Chat = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
};

export type Settings = {
  system: string;
  temperature: number;
  maxTokens: number;
  thinking: boolean;
  useGpu: boolean;
  contextSize: number;
};

export const DEFAULT_SETTINGS: Settings = {
  system: "",
  temperature: 0.7,
  maxTokens: 1024,
  thinking: true,
  useGpu: false,
  contextSize: 4096,
};

const KEYS = {
  chats: "unmuzzled.chats",
  settings: "unmuzzled.settings",
  model: "unmuzzled.model",
  download: "unmuzzled.download",
};

async function read<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function write(key: string, value: unknown) {
  try {
    if (value == null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export const store = {
  loadChats: () => read<Chat[]>(KEYS.chats, []),
  saveChats: (chats: Chat[]) => write(KEYS.chats, chats),
  loadSettings: async () => ({ ...DEFAULT_SETTINGS, ...(await read<Partial<Settings>>(KEYS.settings, {})) }),
  saveSettings: (s: Settings) => write(KEYS.settings, s),
  loadModel: () => read<InstalledModel | null>(KEYS.model, null),
  saveModel: (m: InstalledModel | null) => write(KEYS.model, m),
  loadDownload: () => read<unknown>(KEYS.download, null),
  saveDownload: (state: unknown) => write(KEYS.download, state),
};

export type InstalledModel = {
  uri: string;
  name: string;
  file: string;
  sizeBytes: number;
};

export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export function titleFrom(text: string) {
  const line = text.trim().split("\n")[0].replace(/\s+/g, " ");
  if (line.length <= 48) return line || "New chat";
  return line.slice(0, 48).replace(/\s+\S*$/, "") + "…";
}

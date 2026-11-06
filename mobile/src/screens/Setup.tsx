import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "../insets";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { Icon } from "../components/Icon";
import { Colors, font, useColors } from "../theme";
import { DEFAULT_MODEL, DownloadProgress, ModelDownload, deviceInfo, gb, importModelFile, memoryVerdict } from "../model";
import type { InstalledModel } from "../storage";

type Phase =
  | { kind: "idle" }
  | { kind: "downloading"; paused: boolean }
  | { kind: "copying"; name: string; size: number }
  | { kind: "error"; message: string };

export function Setup({ onInstalled }: { onInstalled: (m: InstalledModel) => void }) {
  const c = useColors();
  const s = styles(c);
  const insets = useSafeAreaInsets();
  const info = useRef(deviceInfo()).current;
  const verdict = memoryVerdict(info.totalMemory);

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [progress, setProgress] = useState<DownloadProgress>({ written: 0, total: DEFAULT_MODEL.sizeBytes });
  const [speed, setSpeed] = useState(0);
  const [hasPaused, setHasPaused] = useState(false);
  const download = useRef<ModelDownload | null>(null);
  const sample = useRef({ t: 0, bytes: 0 });

  useEffect(() => { ModelDownload.hasPausedDownload().then(setHasPaused); }, []);

  // Android may stop network work in the background, so pause cleanly and save
  // the resume point when the app is backgrounded; resume when it comes back.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (phase.kind !== "downloading" || phase.paused) return;
      if (state === "background") download.current?.pause();
      if (state === "active") void run();
    });
    return () => sub.remove();
  }, [phase]);

  const onProgress = (p: DownloadProgress) => {
    setProgress(p);
    const now = Date.now();
    const dt = (now - sample.current.t) / 1000;
    if (dt >= 1) {
      setSpeed((p.written - sample.current.bytes) / dt);
      sample.current = { t: now, bytes: p.written };
    }
  };

  async function run() {
    setPhase({ kind: "downloading", paused: false });
    sample.current = { t: Date.now(), bytes: progress.written };
    await activateKeepAwakeAsync("model-download");
    try {
      download.current ??= new ModelDownload(onProgress);
      const installed = await download.current.start();
      if (installed) onInstalled(installed);
    } catch (err) {
      setPhase({ kind: "error", message: `Download failed: ${(err as Error).message}. Your progress is kept — tap Resume to continue.` });
      await download.current?.pause().catch(() => {});
      setHasPaused(true);
    } finally {
      deactivateKeepAwake("model-download");
    }
  }

  async function pause() {
    await download.current?.pause();
    setPhase({ kind: "downloading", paused: true });
    setSpeed(0);
  }

  async function cancel() {
    await download.current?.cancel();
    download.current = null;
    setHasPaused(false);
    setProgress({ written: 0, total: DEFAULT_MODEL.sizeBytes });
    setPhase({ kind: "idle" });
  }

  async function importFile() {
    try {
      const installed = await importModelFile((name, size) => setPhase({ kind: "copying", name, size }));
      if (installed) onInstalled(installed);
      else setPhase({ kind: "idle" });
    } catch (err) {
      setPhase({ kind: "error", message: (err as Error).message });
    }
  }

  const pct = progress.total > 0 ? progress.written / progress.total : 0;
  const eta = speed > 0 ? (progress.total - progress.written) / speed : null;
  const notEnoughDisk = info.freeDisk < DEFAULT_MODEL.sizeBytes * 1.05;

  return (
    <ScrollView style={s.root} contentContainerStyle={[s.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>
      <View style={s.brand}>
        <Icon name="mark" size={26} color={c.accent} strokeWidth={1.75} />
        <Text style={s.wordmark}>Unmuzzled</Text>
      </View>

      <Text style={s.title}>A private AI that lives on your phone.</Text>
      <Text style={s.lede}>
        The model runs entirely on this device. Once it's downloaded, nothing you type ever leaves your phone — no account, no internet needed.
      </Text>

      <View style={s.card}>
        <Text style={s.cardEyebrow}>Model</Text>
        <Text style={s.cardTitle}>{DEFAULT_MODEL.name}</Text>
        <Text style={s.cardSub}>{DEFAULT_MODEL.variant}</Text>
        <View style={s.divider} />
        <Row c={c} label="Download" value={gb(DEFAULT_MODEL.sizeBytes)} />
        <Row
          c={c}
          label="Your phone's memory"
          value={info.totalMemory ? gb(info.totalMemory) : "Unknown"}
          tone={verdict === "good" ? "ok" : verdict === "tight" ? "warn" : verdict === "insufficient" ? "bad" : undefined}
        />
        <Row c={c} label="Free storage" value={gb(info.freeDisk)} tone={notEnoughDisk ? "bad" : "ok"} />
        {verdict === "tight" && (
          <Text style={[s.note, { color: c.warn }]}>Memory is tight for a 9B model. Close other apps before chatting.</Text>
        )}
        {verdict === "insufficient" && (
          <Text style={[s.note, { color: c.danger }]}>
            This phone likely doesn't have enough memory for a 9B model. You can import a smaller GGUF model instead.
          </Text>
        )}
      </View>

      {phase.kind === "downloading" && (
        <View style={s.progressBlock}>
          <View style={s.track}><View style={[s.fill, { width: `${Math.max(1, pct * 100)}%` }]} /></View>
          <View style={s.progressMeta}>
            <Text style={s.mono}>{gb(progress.written)} / {gb(progress.total)}</Text>
            <Text style={s.mono}>
              {phase.paused ? "Paused" : speed > 0 ? `${(speed / 1e6).toFixed(1)} MB/s${eta ? ` · ${formatEta(eta)} left` : ""}` : "Starting…"}
            </Text>
          </View>
          <Text style={s.hint}>Keep the app open — the screen stays on until the download finishes. If you leave, it resumes when you come back.</Text>
          <View style={s.row}>
            <Button c={c} kind="secondary" icon={phase.paused ? "play" : "pause"} label={phase.paused ? "Resume" : "Pause"} onPress={phase.paused ? run : pause} />
            <Button c={c} kind="ghost" label="Cancel" onPress={cancel} />
          </View>
        </View>
      )}

      {phase.kind === "copying" && (
        <View style={s.progressBlock}>
          <View style={s.copying}>
            <ActivityIndicator color={c.accent} />
            <Text style={s.cardSub}>Copying {phase.name}{phase.size ? ` (${gb(phase.size)})` : ""} — this can take a minute.</Text>
          </View>
        </View>
      )}

      {(phase.kind === "idle" || phase.kind === "error") && (
        <View style={s.actions}>
          {phase.kind === "error" && <Text style={[s.note, { color: c.danger, marginBottom: 12 }]}>{phase.message}</Text>}
          <Button
            c={c}
            kind="primary"
            icon="download"
            label={hasPaused ? "Resume download" : `Download model · ${gb(DEFAULT_MODEL.sizeBytes)}`}
            onPress={run}
            disabled={notEnoughDisk && !hasPaused}
          />
          <Button c={c} kind="secondary" icon="folder" label="I already have a .gguf file" onPress={importFile} />
          <Text style={s.hint}>Wi‑Fi recommended. The download comes straight from Hugging Face.</Text>
        </View>
      )}

      <Text style={s.footer}>
        This model has had its refusal training removed. It can produce content other assistants won't and can be wrong. You're responsible for how you use it.
      </Text>
    </ScrollView>
  );
}

function formatEta(seconds: number) {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

function Row({ c, label, value, tone }: { c: Colors; label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "bad" ? c.danger : tone === "warn" ? c.warn : c.ink;
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
      <Text style={{ fontFamily: font.regular, fontSize: 14, color: c.muted }}>{label}</Text>
      <Text style={{ fontFamily: font.mono, fontSize: 13.5, color }}>{value}</Text>
    </View>
  );
}

export function Button({ c, kind, label, icon, onPress, disabled }: {
  c: Colors;
  kind: "primary" | "secondary" | "ghost" | "danger";
  label: string;
  icon?: Parameters<typeof Icon>[0]["name"];
  onPress: () => void;
  disabled?: boolean;
}) {
  const bg = kind === "primary" ? c.ink : kind === "secondary" ? c.surface : "transparent";
  const fg = kind === "primary" ? c.bg : kind === "danger" ? c.danger : c.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: c.line }}
      style={({ pressed }) => [
        {
          flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
          height: 48, paddingHorizontal: 18, borderRadius: 12,
          backgroundColor: bg,
          borderWidth: kind === "secondary" || kind === "danger" ? 1 : 0,
          borderColor: kind === "danger" ? c.danger : c.lineStrong,
          opacity: disabled ? 0.35 : pressed ? 0.85 : 1,
          flexGrow: kind === "ghost" ? 0 : 1,
        },
      ]}
    >
      {icon && <Icon name={icon} size={18} color={fg} />}
      <Text style={{ fontFamily: font.medium, fontSize: 15, color: fg }}>{label}</Text>
    </Pressable>
  );
}

const styles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    content: { paddingHorizontal: 22 },
    brand: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 36 },
    wordmark: { fontFamily: font.semibold, fontSize: 18, color: c.ink, letterSpacing: -0.2 },
    title: { fontFamily: font.semibold, fontSize: 28, lineHeight: 34, color: c.ink, letterSpacing: -0.6 },
    lede: { fontFamily: font.regular, fontSize: 15.5, lineHeight: 23, color: c.muted, marginTop: 10, marginBottom: 26 },
    card: { backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 18 },
    cardEyebrow: { fontFamily: font.mono, fontSize: 11.5, color: c.muted, marginBottom: 8 },
    cardTitle: { fontFamily: font.semibold, fontSize: 16.5, color: c.ink },
    cardSub: { fontFamily: font.regular, fontSize: 14, color: c.muted, marginTop: 2, flexShrink: 1 },
    divider: { height: 1, backgroundColor: c.line, marginVertical: 14 },
    note: { fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, marginTop: 8 },
    actions: { marginTop: 24, gap: 10 },
    row: { flexDirection: "row", gap: 10, marginTop: 14 },
    hint: { fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: c.faint, marginTop: 10, textAlign: "center" },
    progressBlock: { marginTop: 24 },
    track: { height: 6, borderRadius: 6, backgroundColor: c.line, overflow: "hidden" },
    fill: { height: 6, borderRadius: 6, backgroundColor: c.accent },
    progressMeta: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
    mono: { fontFamily: font.mono, fontSize: 12.5, color: c.ink2 },
    copying: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 12, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line },
    footer: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: c.faint, marginTop: 32, textAlign: "center" },
  });

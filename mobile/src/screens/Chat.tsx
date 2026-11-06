import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Animated, BackHandler, Easing, FlatList, KeyboardAvoidingView, Pressable,
  StyleSheet, Text, TextInput, View, useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "../insets";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { Icon } from "../components/Icon";
import { MessageView } from "../components/MessageView";
import { SettingsSheet } from "../components/SettingsSheet";
import { Colors, font, useColors } from "../theme";
import { EngineInfo, generate, loadModel, stopGenerating, unloadModel } from "../engine";
import { deleteInstalledModel } from "../model";
import { Chat, InstalledModel, Message, Settings, store, titleFrom, uid } from "../storage";

const STARTERS = [
  { title: "Explain a concept", prompt: "Explain how quantisation (Q4_K_M vs Q8_0) affects a language model's quality and memory use. Keep it practical." },
  { title: "Draft something", prompt: "Draft a short, direct email declining a meeting and proposing an async update instead." },
  { title: "Make a plan", prompt: "Give me a 4-week plan to learn the fundamentals of linear algebra for machine learning." },
];

type Props = { model: InstalledModel; onModelRemoved: () => void };

export function ChatScreen({ model, onModelRemoved }: Props) {
  const c = useColors();
  const s = useMemo(() => styles(c), [c]);
  const insets = useSafeAreaInsets();

  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [loadPct, setLoadPct] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const list = useRef<FlatList<Message>>(null);
  const atBottom = useRef(true);

  const active = chats.find((ch) => ch.id === activeId) ?? null;

  useEffect(() => {
    store.loadChats().then((saved) =>
      // Drop replies left half-finished if the app was closed mid-answer.
      setChats(saved.map((ch) => ({ ...ch, messages: ch.messages.filter((m) => m.role === "user" || m.content || m.error) }))),
    );
    store.loadSettings().then(setSettings);
  }, []);

  // (Re)load the model when it or a setting that affects loading changes.
  useEffect(() => {
    if (!settings) return;
    let cancelled = false;
    setEngine(null);
    setLoadError(null);
    setLoadPct(0);
    loadModel(model.uri, settings, (p) => !cancelled && setLoadPct(p))
      .then((info) => !cancelled && setEngine(info))
      .catch((err) => !cancelled && setLoadError(String(err?.message ?? err)));
    return () => { cancelled = true; };
  }, [model.uri, settings?.useGpu, settings?.contextSize]);

  const persist = useCallback((next: Chat[]) => { setChats(next); store.saveChats(next); }, []);

  const updateSettings = (next: Settings) => { setSettings(next); store.saveSettings(next); };

  // Android back button closes the drawer before leaving the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (drawerOpen) { setDrawerOpen(false); return true; }
      return false;
    });
    return () => sub.remove();
  }, [drawerOpen]);

  async function run(chat: Chat) {
    if (!settings || !engine) return;
    const reply: Message = { id: uid(), role: "assistant", content: "", reasoning: "", reasoningSeconds: null, stats: null, error: null };
    const history = chat.messages.filter((m) => m.role === "user" || m.content);
    let working: Chat = { ...chat, messages: [...chat.messages, reply], updatedAt: Date.now() };

    setChats((prev) => [working, ...prev.filter((x) => x.id !== chat.id)]);
    setStreamingId(reply.id);
    atBottom.current = true;
    await activateKeepAwakeAsync("generate");

    const started = Date.now();
    let reasoningEnd: number | null = null;
    let pending: Partial<Message> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Tokens arrive faster than the list can re-render; batch updates.
    const flush = () => {
      timer = null;
      if (!pending) return;
      const patch = pending;
      pending = null;
      setChats((prev) => prev.map((x) => x.id !== chat.id ? x : {
        ...x, messages: x.messages.map((m) => m.id === reply.id ? { ...m, ...patch } : m),
      }));
    };

    try {
      const result = await generate(history, settings, ({ content, reasoning }) => {
        if (content && reasoning && reasoningEnd == null) reasoningEnd = Date.now();
        pending = { content, reasoning };
        timer ??= setTimeout(flush, 70);
      });
      if (timer) clearTimeout(timer);
      Object.assign(reply, {
        content: result.content,
        reasoning: result.reasoning,
        reasoningSeconds: result.reasoning ? ((reasoningEnd ?? Date.now()) - started) / 1000 : null,
        stats: result.stats,
      });
    } catch (err) {
      if (timer) clearTimeout(timer);
      reply.error = String((err as Error)?.message ?? err);
    } finally {
      deactivateKeepAwake("generate");
      setStreamingId(null);
      setChats((prev) => {
        const next = prev.map((x) => x.id !== chat.id ? x : {
          ...x, updatedAt: Date.now(), messages: x.messages.map((m) => m.id === reply.id ? { ...m, ...reply, content: reply.content || m.content, reasoning: reply.reasoning || m.reasoning } : m),
        });
        store.saveChats(next);
        return next;
      });
    }
  }

  function send(text = input) {
    const body = text.trim();
    if (!body || streamingId || !engine) return;
    const now = Date.now();
    const userMsg: Message = { id: uid(), role: "user", content: body };
    const chat: Chat = active
      ? { ...active, messages: [...active.messages, userMsg], updatedAt: now }
      : { id: uid(), title: titleFrom(body), createdAt: now, updatedAt: now, messages: [userMsg] };
    setActiveId(chat.id);
    setInput("");
    run(chat);
  }

  function regenerate() {
    if (!active || streamingId) return;
    const msgs = [...active.messages];
    if (msgs.at(-1)?.role === "assistant") msgs.pop();
    run({ ...active, messages: msgs });
  }

  function newChat() {
    setActiveId(null);
    setDrawerOpen(false);
  }

  function deleteChat(id: string) {
    if (streamingId && active?.id === id) stopGenerating();
    persist(chats.filter((x) => x.id !== id));
    if (activeId === id) setActiveId(null);
  }

  const ready = !!engine && !!settings;
  const streaming = !!streamingId;
  const messages = active?.messages ?? [];

  return (
    <View style={s.root}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {/* Header */}
        <View style={[s.header, { paddingTop: insets.top }]}>
          <HeaderButton c={c} icon="menu" onPress={() => setDrawerOpen(true)} label="Open chats" />
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={s.headerTitle} numberOfLines={1}>{active?.title ?? "Unmuzzled"}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={[s.dot, { backgroundColor: loadError ? c.danger : ready ? c.ok : c.warn }]} />
              <Text style={s.headerSub} numberOfLines={1}>
                {loadError ? "Failed to load" : ready ? `${engine!.gpu ? "GPU" : "CPU"} · on-device` : `Loading model ${Math.round(loadPct)}%`}
              </Text>
            </View>
          </View>
          <HeaderButton c={c} icon="compose" onPress={newChat} label="New chat" />
        </View>

        {/* Thread */}
        {messages.length === 0 ? (
          <Empty c={c} s={s} model={model} ready={ready} loadPct={loadPct} loadError={loadError} onPick={(p) => send(p)} />
        ) : (
          <FlatList
            ref={list}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item, index }) => (
              <MessageView
                message={item}
                c={c}
                live={item.id === streamingId}
                isLast={index === messages.length - 1}
                showStats
                onRegenerate={regenerate}
              />
            )}
            contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 16 }}
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
              atBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
            }}
            scrollEventThrottle={64}
            onContentSizeChange={() => atBottom.current && list.current?.scrollToEnd({ animated: false })}
            keyboardShouldPersistTaps="handled"
          />
        )}

        {/* Composer */}
        <View style={[s.composerWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={s.composer}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={!ready ? "The model is loading…" : active ? "Reply" : "Message the model"}
              placeholderTextColor={c.faint}
              multiline
              style={s.input}
              editable={!loadError}
            />
            <View style={s.composerBar}>
              <Pressable
                onPress={() => settings && updateSettings({ ...settings, thinking: !settings.thinking })}
                style={[s.chip, settings?.thinking && { backgroundColor: c.accentSoft, borderColor: c.accent }]}
                hitSlop={6}
              >
                <Icon name="bulb" size={15} color={settings?.thinking ? c.accent : c.muted} />
                <Text style={[s.chipText, { color: settings?.thinking ? c.accent : c.muted }]}>Think</Text>
              </Pressable>
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={() => (streaming ? stopGenerating() : send())}
                disabled={!streaming && (!ready || !input.trim())}
                style={({ pressed }) => [s.send, (!streaming && (!ready || !input.trim())) && { opacity: 0.25 }, pressed && { transform: [{ scale: 0.94 }] }]}
              >
                <Icon name={streaming ? "stop" : "arrowUp"} size={streaming ? 18 : 19} color={c.bg} strokeWidth={2} />
              </Pressable>
            </View>
          </View>
          <Text style={s.footnote}>Runs entirely on this phone. Responses aren't filtered.</Text>
        </View>
      </KeyboardAvoidingView>

      <Drawer
        c={c}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        chats={chats}
        activeId={activeId}
        streamingChatId={streaming ? active?.id ?? null : null}
        onSelect={(id) => { setActiveId(id); setDrawerOpen(false); }}
        onNew={newChat}
        onDelete={(id) => Alert.alert("Delete this chat?", undefined, [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => deleteChat(id) },
        ])}
        onSettings={() => { setDrawerOpen(false); setSettingsOpen(true); }}
        model={model}
        ready={ready}
      />

      {settings && (
        <SettingsSheet
          visible={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          c={c}
          settings={settings}
          onChange={updateSettings}
          model={model}
          engine={engine}
          onDeleteChats={() => { persist([]); setActiveId(null); }}
          onDeleteModel={async () => {
            setSettingsOpen(false);
            await unloadModel();
            await deleteInstalledModel();
            onModelRemoved();
          }}
        />
      )}
    </View>
  );
}

function Empty({ c, s, model, ready, loadPct, loadError, onPick }: {
  c: Colors; s: ReturnType<typeof styles>; model: InstalledModel; ready: boolean; loadPct: number; loadError: string | null; onPick: (p: string) => void;
}) {
  return (
    <View style={s.empty}>
      <Text style={s.eyebrow}>● {model.name}</Text>
      <Text style={s.emptyTitle}>Private by default.</Text>
      <Text style={s.emptyLede}>Everything runs on this phone. Nothing you type is sent anywhere.</Text>
      {loadError ? (
        <View style={s.errorBox}>
          <Text style={{ fontFamily: font.medium, color: c.danger, fontSize: 14.5 }}>The model couldn't be loaded</Text>
          <Text style={{ fontFamily: font.regular, color: c.muted, fontSize: 13.5, marginTop: 4 }}>
            {loadError}{"\n\n"}This usually means the phone ran out of memory. Close other apps, lower the context window in Settings, or turn off GPU.
          </Text>
        </View>
      ) : !ready ? (
        <View style={{ marginTop: 8 }}>
          <View style={s.track}><View style={[s.fill, { width: `${Math.max(2, loadPct)}%` }]} /></View>
          <Text style={[s.emptyLede, { fontSize: 13, marginTop: 10 }]}>Loading the model into memory… this takes 20–60 seconds.</Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {STARTERS.map((st) => (
            <Pressable key={st.title} onPress={() => onPick(st.prompt)} style={({ pressed }) => [s.starter, pressed && { backgroundColor: c.surface }]}>
              <Text style={s.starterTitle}>{st.title}</Text>
              <Text style={s.starterSub} numberOfLines={1}>{st.prompt}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function HeaderButton({ c, icon, onPress, label }: { c: Colors; icon: "menu" | "compose"; onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={6}
      android_ripple={{ color: c.line, borderless: true, radius: 22 }}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} size={21} color={c.ink2} />
    </Pressable>
  );
}

function Drawer({ c, open, onClose, chats, activeId, streamingChatId, onSelect, onNew, onDelete, onSettings, model, ready }: {
  c: Colors; open: boolean; onClose: () => void; chats: Chat[]; activeId: string | null; streamingChatId: string | null;
  onSelect: (id: string) => void; onNew: () => void; onDelete: (id: string) => void; onSettings: () => void;
  model: InstalledModel; ready: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const w = Math.min(320, width * 0.84);
  const x = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
    Animated.timing(x, { toValue: open ? 1 : 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      .start(() => !open && setMounted(false));
  }, [open]);

  if (!mounted) return null;
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim, opacity: x }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>
      <Animated.View style={{
        position: "absolute", top: 0, bottom: 0, left: 0, width: w, backgroundColor: c.sidebar,
        paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8,
        transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-w, 0] }) }],
      }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, height: 48 }}>
          <Icon name="mark" size={21} color={c.accent} strokeWidth={1.75} />
          <Text style={{ fontFamily: font.semibold, fontSize: 16.5, color: c.ink }}>Unmuzzled</Text>
        </View>

        <Pressable onPress={onNew} style={{
          flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 12, marginVertical: 8, height: 44,
          paddingHorizontal: 12, borderRadius: 11, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line,
        }}>
          <Icon name="compose" size={18} color={c.ink} />
          <Text style={{ fontFamily: font.medium, fontSize: 14.5, color: c.ink }}>New chat</Text>
        </Pressable>

        <FlatList
          data={sorted}
          keyExtractor={(ch) => ch.id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 6 }}
          ListEmptyComponent={<Text style={{ fontFamily: font.regular, fontSize: 13.5, color: c.muted, padding: 10 }}>Your conversations will appear here.</Text>}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onSelect(item.id)}
              onLongPress={() => onDelete(item.id)}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "center", height: 42, paddingHorizontal: 12, borderRadius: 10,
                backgroundColor: item.id === activeId ? c.sideActive : pressed ? c.sideActive : "transparent",
              })}
            >
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.regular, fontSize: 14.5, color: item.id === activeId ? c.ink : c.ink2 }}>
                {item.title}
              </Text>
              {item.id === streamingChatId && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.accent }} />}
            </Pressable>
          )}
        />
        {sorted.length > 0 && (
          <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: c.faint, paddingHorizontal: 22, paddingBottom: 6 }}>Long-press a chat to delete it.</Text>
        )}

        <Pressable onPress={onSettings} style={{
          flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 12, paddingHorizontal: 12, paddingVertical: 10,
          borderTopWidth: 1, borderTopColor: c.line,
        }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ready ? c.ok : c.warn }} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontFamily: font.medium, fontSize: 13.5, color: c.ink }}>{model.name}</Text>
            <Text style={{ fontFamily: font.mono, fontSize: 11, color: c.muted }}>{ready ? "ready · on-device" : "loading…"}</Text>
          </View>
          <Icon name="sliders" size={18} color={c.muted} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line },
    headerTitle: { fontFamily: font.medium, fontSize: 15, color: c.ink, maxWidth: "92%" },
    headerSub: { fontFamily: font.mono, fontSize: 11, color: c.muted },
    dot: { width: 6, height: 6, borderRadius: 3 },
    empty: { flex: 1, paddingHorizontal: 22, justifyContent: "center", paddingBottom: 40 },
    eyebrow: { fontFamily: font.mono, fontSize: 11.5, color: c.accent, marginBottom: 14 },
    emptyTitle: { fontFamily: font.semibold, fontSize: 27, letterSpacing: -0.6, color: c.ink },
    emptyLede: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: c.muted, marginTop: 8, marginBottom: 24 },
    starter: { borderWidth: 1, borderColor: c.line, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13 },
    starterTitle: { fontFamily: font.medium, fontSize: 14.5, color: c.ink },
    starterSub: { fontFamily: font.regular, fontSize: 13, color: c.muted, marginTop: 2 },
    errorBox: { borderWidth: 1, borderColor: c.danger, borderRadius: 12, padding: 14 },
    track: { height: 4, borderRadius: 4, backgroundColor: c.line, overflow: "hidden" },
    fill: { height: 4, borderRadius: 4, backgroundColor: c.accent },
    composerWrap: { paddingHorizontal: 12, paddingTop: 6, backgroundColor: c.bg },
    composer: { borderWidth: 1, borderColor: c.lineStrong, borderRadius: 22, backgroundColor: c.surface, paddingTop: 4 },
    input: { fontFamily: font.regular, fontSize: 16, lineHeight: 22, color: c.ink, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, maxHeight: 160 },
    composerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 8, paddingTop: 2 },
    chip: { flexDirection: "row", alignItems: "center", gap: 5, height: 32, paddingHorizontal: 11, borderRadius: 16, borderWidth: 1, borderColor: c.line },
    chipText: { fontFamily: font.medium, fontSize: 13 },
    send: { width: 38, height: 38, borderRadius: 19, backgroundColor: c.ink, alignItems: "center", justifyContent: "center" },
    footnote: { fontFamily: font.regular, fontSize: 11, color: c.faint, textAlign: "center", marginTop: 6 },
  });

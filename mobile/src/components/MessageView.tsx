import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Markdown from "react-native-markdown-display";
import * as Clipboard from "expo-clipboard";
import { Icon } from "./Icon";
import { Colors, font } from "../theme";
import type { Message } from "../storage";

type Props = {
  message: Message;
  c: Colors;
  live: boolean;
  isLast: boolean;
  showStats: boolean;
  onRegenerate?: () => void;
};

export const MessageView = memo(function MessageView({ message: m, c, live, isLast, onRegenerate }: Props) {
  if (m.role === "user") return <UserMessage m={m} c={c} />;
  return <AssistantMessage m={m} c={c} live={live} isLast={isLast} onRegenerate={onRegenerate} />;
});

function UserMessage({ m, c }: { m: Message; c: Colors }) {
  return (
    <View style={{ alignItems: "flex-end", paddingVertical: 10 }}>
      <Pressable
        onLongPress={() => Clipboard.setStringAsync(m.content)}
        style={{
          maxWidth: "86%",
          backgroundColor: c.userBubble,
          borderRadius: 20,
          borderBottomRightRadius: 6,
          paddingHorizontal: 15,
          paddingVertical: 10,
        }}
      >
        <Text selectable style={{ fontFamily: font.regular, fontSize: 15.5, lineHeight: 23, color: c.ink }}>{m.content}</Text>
      </Pressable>
    </View>
  );
}

function AssistantMessage({ m, c, live, isLast, onRegenerate }: {
  m: Message; c: Colors; live: boolean; isLast: boolean; onRegenerate?: () => void;
}) {
  const thinking = live && !m.content;
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const [copied, setCopied] = useState(false);
  const md = useMemo(() => markdownStyles(c), [c]);

  // Show reasoning while the model thinks, fold it away once the answer starts.
  useEffect(() => { if (!touched) setOpen(thinking); }, [thinking, touched]);

  const hasReasoning = !!m.reasoning?.trim();
  const label = thinking ? "Thinking" : m.reasoningSeconds != null ? `Thought for ${duration(m.reasoningSeconds)}` : "Reasoning";

  return (
    <View style={{ paddingVertical: 10 }}>
      {hasReasoning && (
        <View style={{ marginBottom: 8 }}>
          <Pressable
            onPress={() => { setTouched(true); setOpen((o) => !o); }}
            hitSlop={8}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 4 }}
          >
            <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
              <Icon name="chevron" size={14} color={c.muted} />
            </View>
            {thinking ? <Shimmer text={label} c={c} /> : (
              <Text style={{ fontFamily: font.regular, fontSize: 13.5, color: c.muted }}>{label}</Text>
            )}
          </Pressable>
          {open && (
            <View style={{ borderLeftWidth: 2, borderLeftColor: c.line, paddingLeft: 14, marginTop: 6, marginLeft: 3 }}>
              <Text selectable style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 21, color: c.muted }}>
                {m.reasoning!.trim()}
              </Text>
            </View>
          )}
        </View>
      )}

      {live && !m.content && !hasReasoning ? (
        <Dots c={c} />
      ) : m.content ? (
        <Markdown style={md} onLinkPress={(url) => { Linking.openURL(url); return false; }}>
          {m.content + (live ? " ▍" : "")}
        </Markdown>
      ) : null}

      {!!m.error && (
        <View style={{ marginTop: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: c.danger }}>
          <Text style={{ fontFamily: font.regular, fontSize: 14, color: c.danger }}>{m.error}</Text>
        </View>
      )}

      {!live && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginTop: 6, marginLeft: -6 }}>
          <IconButton c={c} name={copied ? "check" : "copy"} color={copied ? c.accent : c.muted} onPress={async () => {
            await Clipboard.setStringAsync(m.content);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }} />
          {isLast && onRegenerate && <IconButton c={c} name="retry" color={c.muted} onPress={onRegenerate} />}
          {m.stats && (
            <Text style={{ fontFamily: font.mono, fontSize: 11.5, color: c.faint, marginLeft: 6 }}>
              {m.stats.tokens} tok · {m.stats.tokensPerSecond.toFixed(1)} tok/s{m.stats.stopped ? " · stopped" : ""}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

function IconButton({ c, name, color, onPress }: { c: Colors; name: "copy" | "check" | "retry"; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} android_ripple={{ color: c.line, borderless: true, radius: 18 }} style={{ padding: 7 }}>
      <Icon name={name} size={17} color={color} />
    </Pressable>
  );
}

function Dots({ c }: { c: Colors }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <View style={{ flexDirection: "row", gap: 5, paddingVertical: 10 }}>
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={{
            width: 6, height: 6, borderRadius: 3, backgroundColor: c.faint,
            opacity: v.interpolate({ inputRange: [0, (i + 1) / 4, (i + 2) / 4, 1], outputRange: [0.3, 1, 0.3, 0.3] }),
          }}
        />
      ))}
    </View>
  );
}

function Shimmer({ text, c }: { text: string; c: Colors }) {
  const v = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.45, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return <Animated.Text style={{ fontFamily: font.regular, fontSize: 13.5, color: c.ink2, opacity: v }}>{text}</Animated.Text>;
}

const duration = (s: number) => (s < 60 ? `${Math.max(1, Math.round(s))}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`);

function markdownStyles(c: Colors) {
  return StyleSheet.create({
    body: { fontFamily: font.regular, fontSize: 15.5, lineHeight: 24, color: c.ink },
    paragraph: { marginTop: 0, marginBottom: 10 },
    heading1: { fontFamily: font.semibold, fontSize: 21, lineHeight: 28, marginTop: 14, marginBottom: 6 },
    heading2: { fontFamily: font.semibold, fontSize: 18.5, lineHeight: 25, marginTop: 14, marginBottom: 6 },
    heading3: { fontFamily: font.semibold, fontSize: 16.5, lineHeight: 23, marginTop: 12, marginBottom: 4 },
    strong: { fontFamily: font.semibold },
    em: { fontStyle: "italic" },
    link: { color: c.accent, textDecorationLine: "underline" },
    bullet_list: { marginBottom: 8 },
    ordered_list: { marginBottom: 8 },
    list_item: { marginVertical: 2 },
    bullet_list_icon: { color: c.faint, marginRight: 8 },
    ordered_list_icon: { color: c.faint, fontFamily: font.mono, marginRight: 8 },
    code_inline: {
      fontFamily: font.mono, fontSize: 13.5, backgroundColor: c.codeBg, color: c.ink,
      borderRadius: 5, borderWidth: 1, borderColor: c.line, paddingHorizontal: 4,
    },
    fence: {
      fontFamily: font.mono, fontSize: 13, lineHeight: 20, backgroundColor: c.codeBg, color: c.ink,
      borderRadius: 10, borderWidth: 1, borderColor: c.line, padding: 12, marginVertical: 8,
    },
    code_block: {
      fontFamily: font.mono, fontSize: 13, lineHeight: 20, backgroundColor: c.codeBg, color: c.ink,
      borderRadius: 10, borderWidth: 1, borderColor: c.line, padding: 12, marginVertical: 8,
    },
    blockquote: { backgroundColor: "transparent", borderLeftWidth: 3, borderLeftColor: c.lineStrong, paddingLeft: 12, marginVertical: 6 },
    hr: { backgroundColor: c.line, height: 1, marginVertical: 14 },
    table: { borderWidth: 1, borderColor: c.line, borderRadius: 8, marginVertical: 8 },
    thead: { backgroundColor: c.surface2 },
    th: { padding: 8, fontFamily: font.semibold },
    td: { padding: 8, borderTopWidth: 1, borderColor: c.line },
    tr: { borderBottomWidth: 0 },
  });
}

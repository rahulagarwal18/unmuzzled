import { useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "../insets";
import { Icon } from "./Icon";
import { Colors, font } from "../theme";
import { gb } from "../model";
import type { InstalledModel, Settings } from "../storage";
import type { EngineInfo } from "../engine";

type Props = {
  visible: boolean;
  onClose: () => void;
  c: Colors;
  settings: Settings;
  onChange: (s: Settings) => void;
  model: InstalledModel;
  engine: EngineInfo | null;
  onDeleteModel: () => void;
  onDeleteChats: () => void;
};

export function SettingsSheet({ visible, onClose, c, settings, onChange, model, engine, onDeleteModel, onDeleteChats }: Props) {
  const insets = useSafeAreaInsets();
  const s = styles(c);
  const [system, setSystem] = useState(settings.system);
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => { set({ system }); onClose(); }} statusBarTranslucent navigationBarTranslucent>
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.head}>
          <Text style={s.title}>Settings</Text>
          <Pressable onPress={() => { set({ system }); onClose(); }} hitSlop={10} style={s.close}>
            <Icon name="x" size={20} color={c.ink2} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
          <Section c={c} title="Model">
            <Spec c={c} k="Name" v={model.name} />
            <Spec c={c} k="Size" v={gb(model.sizeBytes)} />
            <Spec c={c} k="Runs on" v={engine ? (engine.gpu ? "GPU (OpenCL)" : "CPU") : "Loading…"} />
            <Spec c={c} k="Context" v={`${settings.contextSize.toLocaleString()} tokens`} />
          </Section>

          <Section c={c} title="Behaviour">
            <ToggleRow
              c={c}
              label="Think before answering"
              help="Better answers to hard questions. Turn off for faster replies to simple ones."
              value={settings.thinking}
              onValueChange={(thinking) => set({ thinking })}
            />
            <Text style={s.label}>System prompt</Text>
            <TextInput
              value={system}
              onChangeText={setSystem}
              onBlur={() => set({ system })}
              placeholder="Optional. Sets the model's role, tone or rules for every chat."
              placeholderTextColor={c.faint}
              multiline
              style={s.field}
            />
            <Stepper c={c} label="Temperature" value={settings.temperature.toFixed(2)}
              onMinus={() => set({ temperature: Math.max(0, +(settings.temperature - 0.1).toFixed(2)) })}
              onPlus={() => set({ temperature: Math.min(2, +(settings.temperature + 0.1).toFixed(2)) })}
              help="Lower is focused and repeatable. Higher is more varied." />
            <Stepper c={c} label="Max response length" value={`${settings.maxTokens} tok`}
              onMinus={() => set({ maxTokens: Math.max(256, settings.maxTokens - 256) })}
              onPlus={() => set({ maxTokens: Math.min(8192, settings.maxTokens + 256) })} />
          </Section>

          <Section c={c} title="Performance">
            <ToggleRow
              c={c}
              label="Use GPU (experimental)"
              help="Offloads the model to the phone's GPU on Snapdragon (Adreno 700+) chips. Reloads the model."
              value={settings.useGpu}
              onValueChange={(useGpu) => set({ useGpu })}
            />
            <Stepper c={c} label="Context window" value={`${settings.contextSize / 1024}K`}
              onMinus={() => set({ contextSize: Math.max(2048, settings.contextSize / 2) })}
              onPlus={() => set({ contextSize: Math.min(16384, settings.contextSize * 2) })}
              help="How much of the conversation the model remembers. Larger uses more memory. Reloads the model." />
          </Section>

          <Section c={c} title="Data">
            <Text style={s.help}>Chats are stored only on this phone.</Text>
            <View style={{ gap: 10, marginTop: 12 }}>
              <DangerButton c={c} label="Delete all chats" onPress={() =>
                Alert.alert("Delete all chats?", "This can't be undone.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: onDeleteChats },
                ])} />
              <DangerButton c={c} label={`Delete model (${gb(model.sizeBytes)})`} onPress={() =>
                Alert.alert("Delete the model?", "You'll need to download or import it again to chat.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: onDeleteModel },
                ])} />
            </View>
          </Section>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Section({ c, title, children }: { c: Colors; title: string; children: React.ReactNode }) {
  return (
    <View style={{ paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: c.line }}>
      <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: c.muted, marginBottom: 10 }}>{title}</Text>
      {children}
    </View>
  );
}

function Spec({ c, k, v }: { c: Colors; k: string; v: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 16, paddingVertical: 5 }}>
      <Text style={{ fontFamily: font.regular, fontSize: 14, color: c.muted }}>{k}</Text>
      <Text style={{ fontFamily: font.mono, fontSize: 13, color: c.ink, flexShrink: 1, textAlign: "right" }}>{v}</Text>
    </View>
  );
}

function ToggleRow({ c, label, help, value, onValueChange }: {
  c: Colors; label: string; help?: string; value: boolean; onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 8 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.regular, fontSize: 15, color: c.ink }}>{label}</Text>
        {help && <Text style={{ fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: c.muted, marginTop: 2 }}>{help}</Text>}
      </View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: c.accent, false: c.lineStrong }} thumbColor="#ffffff" />
    </View>
  );
}

function Stepper({ c, label, value, onMinus, onPlus, help }: {
  c: Colors; label: string; value: string; onMinus: () => void; onPlus: () => void; help?: string;
}) {
  const btn = { width: 36, height: 34, alignItems: "center" as const, justifyContent: "center" as const };
  return (
    <View style={{ paddingVertical: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontFamily: font.regular, fontSize: 15, color: c.ink }}>{label}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: c.lineStrong, borderRadius: 10, overflow: "hidden" }}>
          <Pressable onPress={onMinus} style={btn} android_ripple={{ color: c.line }}>
            <Text style={{ fontFamily: font.medium, fontSize: 18, color: c.ink2 }}>−</Text>
          </Pressable>
          <Text style={{ fontFamily: font.mono, fontSize: 13, color: c.ink, minWidth: 74, textAlign: "center" }}>{value}</Text>
          <Pressable onPress={onPlus} style={btn} android_ripple={{ color: c.line }}>
            <Text style={{ fontFamily: font.medium, fontSize: 18, color: c.ink2 }}>+</Text>
          </Pressable>
        </View>
      </View>
      {help && <Text style={{ fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: c.muted, marginTop: 6 }}>{help}</Text>}
    </View>
  );
}

function DangerButton({ c, label, onPress }: { c: Colors; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} android_ripple={{ color: c.line }}
      style={{ height: 44, borderRadius: 10, borderWidth: 1, borderColor: c.lineStrong, alignItems: "center", flexDirection: "row", gap: 8, paddingHorizontal: 14 }}>
      <Icon name="trash" size={17} color={c.danger} />
      <Text style={{ fontFamily: font.medium, fontSize: 14.5, color: c.danger }}>{label}</Text>
    </Pressable>
  );
}

const styles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 56, paddingLeft: 20, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: c.line },
    title: { fontFamily: font.semibold, fontSize: 17, color: c.ink },
    close: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    label: { fontFamily: font.regular, fontSize: 15, color: c.ink, marginTop: 12, marginBottom: 8 },
    help: { fontFamily: font.regular, fontSize: 13, color: c.muted },
    field: {
      minHeight: 96, textAlignVertical: "top", borderWidth: 1, borderColor: c.lineStrong, borderRadius: 12,
      backgroundColor: c.surface, padding: 12, fontFamily: font.regular, fontSize: 14.5, lineHeight: 21, color: c.ink,
    },
  });

import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { ChatScreen } from "./src/screens/Chat";
import { Setup } from "./src/screens/Setup";
import { getInstalledModel } from "./src/model";
import { useColors, useIsDark } from "./src/theme";
import type { InstalledModel } from "./src/storage";

export default function App() {
  const c = useColors();
  const dark = useIsDark();
  const [model, setModel] = useState<InstalledModel | null | undefined>(undefined);

  useEffect(() => { getInstalledModel().then(setModel); }, []);
  useEffect(() => { SystemUI.setBackgroundColorAsync(c.bg); }, [c.bg]);

  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      {model === undefined ? (
        <View style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : model ? (
        <ChatScreen model={model} onModelRemoved={() => setModel(null)} />
      ) : (
        <Setup onInstalled={setModel} />
      )}
    </>
  );
}

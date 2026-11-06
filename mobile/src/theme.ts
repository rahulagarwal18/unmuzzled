import { useColorScheme } from "react-native";

// Same palette as the desktop interface (public/styles.css).
const light = {
  bg: "#f6f5f1",
  sidebar: "#efede7",
  sideActive: "#e0ddd4",
  surface: "#ffffff",
  surface2: "#f2f0eb",
  line: "#e4e1d9",
  lineStrong: "#d3cfc5",
  ink: "#1d1c1a",
  ink2: "#45433e",
  muted: "#747069",
  faint: "#a29e95",
  accent: "#2d6a5a",
  accentInk: "#ffffff",
  accentSoft: "#e2ede8",
  warn: "#b7791f",
  danger: "#b3402e",
  ok: "#3f9a6e",
  userBubble: "#ebe8e1",
  codeBg: "#f2f0ea",
  scrim: "rgba(10,10,8,0.28)",
};

const dark: typeof light = {
  bg: "#161615",
  sidebar: "#111110",
  sideActive: "#242422",
  surface: "#1d1d1b",
  surface2: "#252523",
  line: "#2b2a27",
  lineStrong: "#3a3935",
  ink: "#ecebe6",
  ink2: "#cbc8c0",
  muted: "#9a968d",
  faint: "#6b6861",
  accent: "#86c0ad",
  accentInk: "#0f1a16",
  accentSoft: "#1c2925",
  warn: "#e0a54a",
  danger: "#e27b6b",
  ok: "#3f9a6e",
  userBubble: "#262624",
  codeBg: "#1a1a18",
  scrim: "rgba(0,0,0,0.5)",
};

export type Colors = typeof light;

export const font = {
  regular: "IBMPlexSans_400Regular",
  medium: "IBMPlexSans_500Medium",
  semibold: "IBMPlexSans_600SemiBold",
  mono: "IBMPlexMono_400Regular",
};

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

export function useIsDark() {
  return useColorScheme() === "dark";
}

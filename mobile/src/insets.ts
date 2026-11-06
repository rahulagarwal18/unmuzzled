import { useEffect, useReducer } from "react";
import { AppState, Dimensions, StatusBar } from "react-native";
import { requireOptionalNativeModule } from "expo";

// System bar sizes from the local SystemInsets module (modules/system-insets).
type Insets = { top: number; bottom: number; left: number; right: number };

const Native = requireOptionalNativeModule<{ get(): Promise<Insets> }>("SystemInsets");

let current: Insets = { top: StatusBar.currentHeight ?? 0, bottom: 0, left: 0, right: 0 };
const listeners = new Set<() => void>();

async function refresh() {
  if (!Native) return;
  try {
    const next = await Native.get();
    if (next.top === current.top && next.bottom === current.bottom && next.left === current.left && next.right === current.right) return;
    current = next;
    listeners.forEach((notify) => notify());
  } catch {}
}

AppState.addEventListener("change", (s) => s === "active" && refresh());
Dimensions.addEventListener("change", () => refresh());
refresh();

/** Same shape as react-native-safe-area-context's hook. */
export function useSafeAreaInsets(): Insets {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    listeners.add(rerender);
    // Insets aren't known until the window is attached, so ask again after mount.
    refresh();
    const t = setTimeout(refresh, 300);
    return () => { listeners.delete(rerender); clearTimeout(t); };
  }, []);
  return current;
}

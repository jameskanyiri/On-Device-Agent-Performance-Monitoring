import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/** Whether the window can be seen. Anything that loops (an animation, a timer) stops while it
 * can't: nothing animates or ticks when it can't be seen. */
export function useDocumentVisible(): boolean {
  // On the server there is no document; render as visible.
  return useSyncExternalStore(subscribe, () => document.visibilityState === "visible", () => true);
}

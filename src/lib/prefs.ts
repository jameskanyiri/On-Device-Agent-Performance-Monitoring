// Per-browser conveniences (a panel's size, chosen columns): remembered when the
// browser allows, never required.
export function readPref(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private mode: not remembered
  }
}

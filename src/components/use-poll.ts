'use client';

import { useEffect, useState } from 'react';

/**
 * Fetches JSON from the dashboard's API and refetches every `intervalMs`
 * (once when it's 0). Keeps the previous data while refetching.
 */
export function usePoll<T>(url: string, intervalMs: number): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ url: string; data: T | null; error: string | null }>({ url, data: null, error: null });

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        const body = await res.json();
        if (!live) return;
        if (!res.ok) setState({ url, data: null, error: body.error ?? `HTTP ${res.status}` });
        else setState({ url, data: body as T, error: null });
      } catch (e) {
        if (live) setState((prev) => ({ ...prev, url, error: e instanceof Error ? e.message : String(e) }));
      }
    };
    load();
    const id = intervalMs > 0 ? setInterval(load, intervalMs) : undefined;
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [url, intervalMs]);

  // Data from a previous URL (another page) is never shown.
  return state.url === url ? { data: state.data, error: state.error } : { data: null, error: null };
}

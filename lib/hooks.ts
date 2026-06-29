"use client";

import { useEffect, useState } from "react";

/**
 * Returns `false` during SSR and the first client render, then `true` after
 * mount. Gate any `window` / `localStorage` reads behind this hook and load
 * that data inside `useEffect` so the server HTML matches the first paint.
 */
export function useHasHydrated(): boolean {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  return hasHydrated;
}

"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};
const getTrue = () => true;
const getFalse = () => false;

/**
 * Returns `false` during SSR and the very first client render, then `true`
 * after hydration. Use this to gate any code that reads from
 * `window`/`localStorage`, so the first paint matches the server and
 * post-hydration reads stay outside of `useEffect`.
 */
export function useHasHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, getTrue, getFalse);
}

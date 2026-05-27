"use client";

import { useEffect, useState } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { useHasHydrated } from "@/lib/hooks";
import { APP_NAME, TAGLINE } from "@/lib/brand";

const SPLASH_KEY = "birdiebank:pwa-splash-seen";

/** Brief branded splash when launched as installed PWA (first visit per session). */
export function PwaSplash() {
  const hasHydrated = useHasHydrated();
  if (!hasHydrated) return null;
  return <PwaSplashInner />;
}

function PwaSplashInner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;

    if (!standalone) return;
    if (sessionStorage.getItem(SPLASH_KEY) === "1") return;

    sessionStorage.setItem(SPLASH_KEY, "1");
    const show = window.setTimeout(() => setVisible(true), 0);
    const hide = window.setTimeout(() => setVisible(false), 1600);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-[#f8f5ee]"
      role="status"
      aria-live="polite"
      aria-label={`Loading ${APP_NAME}`}
    >
      <BrandLogo className="h-20 w-20" title={APP_NAME} />
      <div className="flex flex-col items-center gap-1 px-8 text-center">
        <span className="text-xl font-semibold tracking-tight text-fairway-900">
          {APP_NAME}
        </span>
        <span className="text-sm text-fairway-900/65">{TAGLINE}</span>
      </div>
    </div>
  );
}

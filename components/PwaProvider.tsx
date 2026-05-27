"use client";

import { useEffect, useState } from "react";

const INSTALL_DISMISS_KEY = "birdiebank_install_dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function useIosInstallHint() {
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(userAgent);
    const isStandalone =
      "standalone" in window.navigator &&
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    setShowHint(isIos && !isStandalone);
  }, []);

  return showHint;
}

function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const showIosHint = useIosInstallHint();

  useEffect(() => {
    setDismissed(sessionStorage.getItem(INSTALL_DISMISS_KEY) === "1");

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    };
  }, []);

  const shouldShow = !dismissed && (deferredPrompt || showIosHint);

  if (!shouldShow) return null;

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    sessionStorage.setItem(INSTALL_DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 rounded-2xl border border-emerald-200 bg-white p-4 shadow-xl">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-slate-950">
            Add BirdieBank to your phone
          </p>
          <p className="text-xs text-slate-600">
            {deferredPrompt
              ? "Install BirdieBank for a faster app-like experience."
              : "On iPhone, tap Share, then Add to Home Screen."}
          </p>
        </div>

        <div className="flex gap-2">
          {deferredPrompt ? (
            <button
              type="button"
              onClick={handleInstall}
              className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
            >
              Install
            </button>
          ) : null}

          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

export function PwaProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <InstallBanner />
    </>
  );
}

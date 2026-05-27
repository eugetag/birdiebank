import type { ReactNode } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { APP_NAME, TAGLINE } from "@/lib/brand";

export const metadata = {
  title: "Offline",
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 bg-background px-6 py-12 text-center">
      <BrandLogo className="h-16 w-16" title={APP_NAME} />
      <div className="flex max-w-sm flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-fairway-900">
          You&apos;re offline
        </h1>
        <p className="text-sm leading-relaxed text-fairway-900/70">
          {TAGLINE} Cached pages may still be available below.
        </p>
      </div>
      <nav className="flex flex-col gap-2 w-full max-w-xs">
        <OfflineLink href="/">Home</OfflineLink>
        <OfflineLink href="/dashboard">Dashboard</OfflineLink>
        <OfflineLink href="/pricing">Pricing</OfflineLink>
      </nav>
    </div>
  );
}

function OfflineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-11 items-center justify-center rounded-full border border-sand bg-white text-sm font-medium text-fairway-800 transition hover:bg-cream"
    >
      {children}
    </Link>
  );
}

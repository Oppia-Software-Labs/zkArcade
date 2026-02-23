"use client";

import Link from "next/link";

interface GameIframeProps {
  src: string;
  title: string;
}

export function GameIframe({ src, title }: GameIframeProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black">
      <Link
        href="/"
        className="fixed top-4 left-4 z-[60] flex items-center gap-2 px-3 py-2 rounded-lg bg-black/70 border border-white/20 text-white/80 hover:text-white hover:bg-black/90 transition-colors text-sm backdrop-blur-sm"
        aria-label="Back to arcade"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </Link>

      <iframe
        src={src}
        title={title}
        className="w-full h-full border-0"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}

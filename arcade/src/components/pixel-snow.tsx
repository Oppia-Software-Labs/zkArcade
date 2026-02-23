"use client";

import { useMemo } from "react";

const FLAKE_COUNT = 80;
const FLAKE_SIZE_MIN = 2;
const FLAKE_SIZE_MAX = 5;

function useSnowflakes() {
  return useMemo(() => {
    return Array.from({ length: FLAKE_COUNT }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      size: FLAKE_SIZE_MIN + Math.random() * (FLAKE_SIZE_MAX - FLAKE_SIZE_MIN),
      duration: 8 + Math.random() * 12,
      delay: Math.random() * -20,
    }));
  }, []);
}

export function PixelSnow() {
  const flakes = useSnowflakes();

  return (
    <div
      className="fixed inset-0 overflow-hidden pointer-events-none z-0"
      aria-hidden
    >
      {flakes.map((f) => (
        <div
          key={f.id}
          className="absolute rounded-sm bg-white/40 animate-pixel-snow"
          style={{
            left: `${f.x}vw`,
            width: `${f.size}px`,
            height: `${f.size}px`,
            animationDuration: `${f.duration}s`,
            animationDelay: `${f.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

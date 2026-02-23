import type { Metadata } from "next";
import "./globals.css";
import { PixelSnow } from "@/components/pixel-snow";
import TargetCursor from "@/components/TargetCursor";

export const metadata: Metadata = {
  title: "Oppia zkArcade",
  description: "Zero-knowledge games on Stellar — Wordle & Battleship",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased h-screen overflow-hidden flex flex-col relative">
        <PixelSnow />
        <TargetCursor targetSelector=".cursor-target" />
        <div className="relative z-10 flex flex-col flex-1 min-h-0">
          {children}
        </div>
      </body>
    </html>
  );
}

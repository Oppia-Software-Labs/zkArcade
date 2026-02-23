import Image from "next/image";
import { GameCarousel } from "@/components/GameCarousel";

export default function HomePage() {
  return (
    <main className="h-screen flex flex-col overflow-hidden">
      <header className="flex-shrink-0 flex justify-center items-center px-4 py-12 md:py-20">
        <Image
          src="/oppia-zkarcade.svg"
          alt="Oppia zkArcade"
          width={400}
          height={146}
          className="w-full max-w-[min(85vw,380px)] h-auto"
          priority
        />
      </header>
      <GameCarousel />
    </main>
  );
}

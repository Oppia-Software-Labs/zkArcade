"use client";

import Image from "next/image";
import Link from "next/link";
import useEmblaCarousel from "embla-carousel-react";
import { useCallback } from "react";
import { GAME_URLS } from "@/config";

const GAMES = [
  { id: "wordle", name: "Wordle", image: "/games/wordle.svg", href: GAME_URLS.wordle },
  { id: "battleship", name: "Battleship", image: "/games/battleship.svg", href: GAME_URLS.battleship },
] as const;

// 10% bigger than 280×168 → 308×185
const CARD_WIDTH_PX = 308;
const CARD_HEIGHT_PX = 185;
const CARD_GAP = 20;
const CARD_PADDING = 16; // p-4, match image padding
// Min width for one slide so 3 cards + gaps fit without overlapping
const SLIDE_MIN_WIDTH = CARD_WIDTH_PX * 3 + CARD_GAP * 2 + CARD_PADDING * 4;

function GameCard({ game }: { game: (typeof GAMES)[number] }) {
  return (
    <Link
      href={game.href}
      target="_blank"
      rel="noopener noreferrer"
      className="cursor-target flex-shrink-0 flex items-center justify-center rounded-xl overflow-hidden border border-white/15 bg-white/[0.06] hover:bg-white/[0.12] hover:border-white/25 transition-all duration-300 hover:scale-[1.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
      style={{ width: CARD_WIDTH_PX, height: CARD_HEIGHT_PX }}
    >
      <Image
        src={game.image}
        alt={game.name}
        width={CARD_WIDTH_PX}
        height={CARD_HEIGHT_PX}
        className="w-full h-full object-contain object-center p-4 ml-4"
      />
    </Link>
  );
}

function MoreGamesSoonCard() {
  return (
    <div
      className="cursor-target flex-shrink-0 flex items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/[0.04] text-white/60 text-center font-medium p-4"
      style={{ width: CARD_WIDTH_PX, height: CARD_HEIGHT_PX }}
    >
      <span className="text-sm md:text-base">More ZK games soon</span>
    </div>
  );
}

/** One slide = two game cards + "more soon" card, with a bit of margin-left */
function TwoCardsSlide() {
  return (
    <div
      className="flex items-center justify-center gap-5 px-2 ml-3 flex-shrink-0"
      style={{ minWidth: SLIDE_MIN_WIDTH }}
    >
      {GAMES.map((game) => (
        <GameCard key={game.id} game={game} />
      ))}
      <MoreGamesSoonCard />
    </div>
  );
}

export function GameCarousel() {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    align: "center",
    containScroll: "trimSnaps",
    dragFree: false,
  });

  const scrollPrev = useCallback(() => {
    emblaApi?.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    emblaApi?.scrollNext();
  }, [emblaApi]);

  return (
    <section className="flex-1 min-h-0 w-full flex flex-col items-center justify-center overflow-hidden px-2">
      <div className="w-full max-w-6xl flex items-center gap-3">
        <button
          type="button"
          onClick={scrollPrev}
          className="cursor-target flex-shrink-0 w-10 h-10 rounded-full border border-white/20 bg-white/5 hover:bg-white/10 flex items-center justify-center text-white transition-colors"
          aria-label="Previous"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0 overflow-hidden" ref={emblaRef}>
          <div className="flex py-4">
            {/* Slides have min-width so all 3 cards fit without overlapping */}
            <div className="flex-[0_0_auto] flex justify-center" style={{ minWidth: SLIDE_MIN_WIDTH }}>
              <TwoCardsSlide />
            </div>
            <div className="flex-[0_0_auto] flex justify-center" style={{ minWidth: SLIDE_MIN_WIDTH }}>
              <TwoCardsSlide />
            </div>
            <div className="flex-[0_0_auto] flex justify-center" style={{ minWidth: SLIDE_MIN_WIDTH }}>
              <TwoCardsSlide />
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={scrollNext}
          className="cursor-target flex-shrink-0 w-10 h-10 rounded-full border border-white/20 bg-white/5 hover:bg-white/10 flex items-center justify-center text-white transition-colors"
          aria-label="Next"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </section>
  );
}

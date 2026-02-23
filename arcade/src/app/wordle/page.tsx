import { GameIframe } from "@/components/GameIframe";
import { GAME_URLS } from "@/config";

export default function WordlePage() {
  return <GameIframe src={GAME_URLS.wordle} title="Wordle" />;
}

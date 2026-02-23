import { GameIframe } from "@/components/GameIframe";
import { GAME_URLS } from "@/config";

export default function BattleshipPage() {
  return <GameIframe src={GAME_URLS.battleship} title="Battleship" />;
}

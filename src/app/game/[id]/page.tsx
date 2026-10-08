"use client";

import { useParams, useRouter } from "next/navigation";
import { GameView } from "@/components/game-view";

export default function GamePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  return <GameView key={id} gameId={id} onNewGame={() => router.push("/")} />;
}

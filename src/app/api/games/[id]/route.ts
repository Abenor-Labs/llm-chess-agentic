import { NextResponse } from "next/server";
import { GameIdSchema } from "@/types/api";
import { getGameDetail } from "@/lib/game-queries";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A non-UUID would make Postgres throw; it simply isn't a game.
  if (!GameIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }
  const detail = await getGameDetail(id);
  if (!detail) return NextResponse.json({ error: "Game not found" }, { status: 404 });
  return NextResponse.json(detail);
}

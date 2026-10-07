import { NextResponse } from "next/server";
import { GameStatusSchema } from "@/types/api";
import { listGames } from "@/lib/game-queries";

/** GET /api/games?status=active|complete&limit=1..100 — games with both models. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = GameStatusSchema.safeParse(searchParams.get("status") ?? "active");
  if (!status.success) {
    return NextResponse.json({ error: "Invalid status. Must be 'active' or 'complete'." }, { status: 400 });
  }
  const rawLimit = searchParams.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return NextResponse.json({ error: "Limit must be an integer between 1 and 100" }, { status: 400 });
  }
  try {
    return NextResponse.json({ games: await listGames(status.data, limit) });
  } catch (error) {
    console.error("Games fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch games" }, { status: 500 });
  }
}

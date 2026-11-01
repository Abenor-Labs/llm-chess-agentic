import { NextResponse } from "next/server";
import { GameStatusSchema } from "@/types/api";
import { arenaOnly, listGames, openRooms, seatedBy } from "@/lib/game-queries";
import { currentUser } from "@/lib/auth/server";

/**
 * GET /api/games?status=active|complete&limit=1..100 — games with both models.
 * Filters: arena=1 (AI vs AI only), open=1 (rooms waiting for a player), mine=1 (games you sit in).
 */
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
    let filter = searchParams.get("arena") === "1" ? arenaOnly : searchParams.get("open") === "1" ? openRooms : undefined;
    if (searchParams.get("mine") === "1") {
      const user = await currentUser();
      if (!user) return NextResponse.json({ games: [] });
      filter = seatedBy(user.id);
    }
    return NextResponse.json({ games: await listGames(status.data, limit, filter) });
  } catch (error) {
    console.error("Games fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch games" }, { status: 500 });
  }
}

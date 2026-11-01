import { NextResponse } from "next/server";
import { z } from "zod";
import { GameIdSchema } from "@/types/api";
import { requireUser } from "@/lib/auth/server";
import { playHumanMove } from "@/lib/game-processor";

const Body = z.object({ move: z.string().trim().min(2).max(10) });

/** Human vs AI: the signed-in player who started the match submits a move (SAN or UCI). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = GameIdSchema.safeParse((await params).id);
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return NextResponse.json({ error: "Send { move } for a valid game." }, { status: 400 });

  const result = await playHumanMove(id.data, user.id, body.data.move);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, ended: result.outcome === "ended" });
}

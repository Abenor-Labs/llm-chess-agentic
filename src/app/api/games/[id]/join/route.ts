import { NextResponse } from "next/server";
import { GameIdSchema } from "@/types/api";
import { requireUser } from "@/lib/auth/server";
import { joinRoom } from "@/lib/game-processor";

/** Human vs Human: a signed-in player takes the empty seat of a room. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = GameIdSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Unknown game." }, { status: 400 });
  const result = await joinRoom(id.data, user.id, user.name?.trim() || "Player");
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ success: true });
}

import { NextResponse } from "next/server";
import { GameIdSchema } from "@/types/api";
import { requireUser } from "@/lib/auth/server";
import { resignGame } from "@/lib/game-processor";

/** A seated player resigns (or cancels a room nobody has joined). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = GameIdSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Unknown game." }, { status: 400 });
  const result = await resignGame(id.data, user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, cancelled: result.cancelled });
}

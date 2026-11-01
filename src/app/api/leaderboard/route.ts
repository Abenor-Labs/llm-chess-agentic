import { NextResponse } from "next/server";
import { db } from "@/db";
import { models } from "@/db/schema";
import { desc, ne } from "drizzle-orm";
import { HUMAN_ID } from "@/lib/provider-ids";

export async function GET() {
  const leaderboard = await db.select().from(models).where(ne(models.id, HUMAN_ID)).orderBy(desc(models.elo), desc(models.gamesPlayed), models.name);
  return NextResponse.json({ models: leaderboard });
}

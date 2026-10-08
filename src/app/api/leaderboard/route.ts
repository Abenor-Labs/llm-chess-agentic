import { NextResponse } from "next/server";
import { db } from "@/db";
import { models } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const leaderboard = await db.select().from(models).orderBy(desc(models.elo), desc(models.gamesPlayed), models.name);
  return NextResponse.json({ models: leaderboard });
}

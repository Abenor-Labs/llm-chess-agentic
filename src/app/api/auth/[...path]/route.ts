import { getAuth } from "@/lib/auth/server";

type Handler = (req: Request, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response>;
const handle = (method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"): Handler => (req, ctx) =>
  (getAuth().handler()[method] as Handler)(req, ctx);

// Resolved per request so `next build` needs no auth env.
export const GET = handle("GET");
export const POST = handle("POST");
export const PUT = handle("PUT");
export const DELETE = handle("DELETE");
export const PATCH = handle("PATCH");

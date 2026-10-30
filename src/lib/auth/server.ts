import { createNeonAuth } from "@neon/auth/next/server";

/**
 * Neon Managed Better Auth. Users and sessions live in the `neon_auth` schema
 * of the Neon branch behind NEON_AUTH_BASE_URL; this app only proxies to it.
 * Admins are users with neon_auth."user".role = 'admin' (granted by SQL, see
 * scripts/grant-admin.ts), never inferred from an email address.
 */
let _auth: ReturnType<typeof createNeonAuth> | null = null;

export function getAuth() {
  if (!_auth) {
    const baseUrl = process.env.NEON_AUTH_BASE_URL;
    const secret = process.env.NEON_AUTH_COOKIE_SECRET;
    if (!baseUrl || !secret) throw new Error("NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET must be set");
    _auth = createNeonAuth({ baseUrl, cookies: { secret } });
  }
  return _auth;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role?: string | null;
}

/** The signed-in user, or null. Never throws for a missing/invalid session. */
export async function currentUser(): Promise<SessionUser | null> {
  try {
    const { data } = await getAuth().getSession();
    return (data?.user as SessionUser | undefined) ?? null;
  } catch (err) {
    console.error("[auth] session lookup failed", err);
    return null;
  }
}

export const isAdmin = (user: SessionUser | null) => user?.role === "admin";

/** Route guard: the user, or a 401/403 Response to return as-is. */
export async function requireUser(opts: { admin?: boolean } = {}): Promise<SessionUser | Response> {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in to do that." }, { status: 401 });
  if (opts.admin && !isAdmin(user)) return Response.json({ error: "Only the admin can do that." }, { status: 403 });
  return user;
}

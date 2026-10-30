"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { authClient } from "@/lib/auth/client";

/** Header sign-in / account control. Also ties PostHog activity to the signed-in user. */
export function UserMenu() {
  const pathname = usePathname();
  const { data, isPending } = authClient.useSession();
  const user = data?.user as { id: string; email: string; name?: string; role?: string | null } | undefined;

  useEffect(() => {
    if (isPending) return;
    if (user) posthog.identify(user.id, { email: user.email, name: user.name, role: user.role ?? "user" });
    else if (posthog._isIdentified()) posthog.reset();
  }, [isPending, user]);

  if (isPending) return null;
  if (!user) {
    return (
      <Link
        href={`/auth/sign-in?next=${encodeURIComponent(pathname)}`}
        className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        data-testid="sign-in"
      >
        Sign in
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-[12rem] truncate text-sm text-slate-600 sm:inline" title={user.email}>
        {user.name || user.email}
        {user.role === "admin" && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">admin</span>}
      </span>
      <button
        onClick={async () => {
          posthog.capture("user_signed_out");
          await authClient.signOut();
          posthog.reset();
        }}
        className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
      >
        Sign out
      </button>
    </div>
  );
}

/** The current session user (client side). */
export function useSessionUser() {
  const { data, isPending } = authClient.useSession();
  const user = data?.user as { id: string; role?: string | null } | undefined;
  return { user, isPending, isAdmin: user?.role === "admin" };
}

"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { authClient } from "@/lib/auth/client";

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/";
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));
    setBusy(true);
    setError(null);
    const res =
      mode === "sign-up"
        ? await authClient.signUp.email({ email, password, name: String(form.get("name") || email.split("@")[0]) })
        : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (res.error) {
      setError(res.error.message ?? "Something went wrong. Try again.");
      return;
    }
    posthog.capture(mode === "sign-up" ? "user_signed_up" : "user_signed_in");
    // Only same-site paths, never an absolute URL from the query string.
    router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/");
    router.refresh();
  }

  const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none";
  return (
    <div className="mx-auto max-w-sm px-4 py-12">
      <h1 className="text-2xl font-bold text-slate-900">{mode === "sign-in" ? "Sign in" : "Create an account"}</h1>
      <p className="mt-1 text-sm text-slate-500">Anyone can watch. You need an account to start a match.</p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        {mode === "sign-up" && (
          <label className="block text-sm font-medium text-slate-700">
            Name
            <input name="name" autoComplete="name" className={`mt-1 ${input}`} />
          </label>
        )}
        <label className="block text-sm font-medium text-slate-700">
          Email
          <input name="email" type="email" required autoComplete="email" className={`mt-1 ${input}`} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Password
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            className={`mt-1 ${input}`}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-rose-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {busy ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
      </form>
      <button
        onClick={() => {
          setMode(mode === "sign-in" ? "sign-up" : "sign-in");
          setError(null);
        }}
        className="mt-4 text-sm font-medium text-slate-600 underline underline-offset-2"
      >
        {mode === "sign-in" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </div>
  );
}

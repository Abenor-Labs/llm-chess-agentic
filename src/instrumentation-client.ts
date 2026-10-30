import posthog from "posthog-js";

// PostHog: pageviews, autocapture, web vitals, session replay and errors. Events
// go through the /ingest rewrite (next.config.ts) so ad blockers don't drop them.
// Signed-in users are identified in components/user-menu.tsx.
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
if (key) {
  posthog.init(key, {
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    defaults: "2025-05-24",
    capture_exceptions: true,
    person_profiles: "identified_only",
  });
  // The PostHog project is shared with other apps; tag every event.
  posthog.register({ app: "llm-chess" });
}

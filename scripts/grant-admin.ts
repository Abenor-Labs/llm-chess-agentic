/**
 * Makes an existing Neon Auth user the arena admin (the only one who can stop
 * matches). The user must sign up in the app first. Runs against the Neon
 * branch that hosts Managed Auth, not the local game database:
 *
 *   AUTH_DATABASE_URL=$(neon connection-string production) pnpm admin:grant you@example.com
 */
import postgres from "postgres";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const url = process.env.AUTH_DATABASE_URL;
  if (!email || !url) {
    console.error("usage: AUTH_DATABASE_URL=... pnpm admin:grant <email>");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });
  try {
    const rows = await sql`UPDATE neon_auth."user" SET role = 'admin' WHERE lower(email) = ${email} RETURNING id, email`;
    if (rows.length === 0) {
      console.error(`No user with email ${email}. Sign up in the app first.`);
      process.exitCode = 1;
    } else {
      console.log(`${rows[0].email} is now admin (sign out and back in to refresh the session).`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

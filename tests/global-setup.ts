import { config } from "dotenv";
import { migrate } from "../scripts/migrate";

/** Brings the test database schema up to date once per run. */
export default async function globalSetup() {
  config({ path: ".env.test", quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn("[db tests] TEST_DATABASE_URL is not set — database integration tests will be skipped.");
    return;
  }
  await migrate(url);
}

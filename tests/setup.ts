import { config } from "dotenv";

config({ path: ".env.test", quiet: true });
// The app's db module connects lazily to DATABASE_URL; point it at the test DB.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

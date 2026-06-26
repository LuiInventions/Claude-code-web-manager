import { config as loadEnv } from "dotenv";
import path from "node:path";

/**
 * Loads environment files BEFORE any other module reads process.env.
 * Imported as the very first import in server.ts. .env.local wins over .env
 * because dotenv never overrides an already-set variable (so a key already
 * present in your shell environment also takes precedence).
 */
loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv();

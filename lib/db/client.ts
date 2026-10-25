import { mkdirSync } from "node:fs"
import path from "node:path"

import { createClient, type Client } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"

import { paths } from "../paths"
import * as schema from "./schema"

/** Relative to the project root (where `bun dev` and the scripts run). */
export const DATABASE_URL = process.env.DATABASE_URL ?? `file:${paths.database.replaceAll("\\", "/")}`

// libSQL creates a missing database file but not its folder (fresh clone, CI, first install).
if (DATABASE_URL.startsWith("file:")) {
  mkdirSync(path.dirname(/*turbopackIgnore: true*/ DATABASE_URL.slice("file:".length)), { recursive: true })
}

const globalForDb = globalThis as unknown as { xStatsClient?: Client }

// Reuse one connection across dev hot reloads.
const client = globalForDb.xStatsClient ?? createClient({ url: DATABASE_URL })
if (process.env.NODE_ENV !== "production") globalForDb.xStatsClient = client

export const db = drizzle(client, { schema })
export { schema }

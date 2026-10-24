import { createClient, type Client } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"

import * as schema from "./schema"

/** Relative to the project root (where `bun dev` and the scripts run). */
export const DATABASE_URL = process.env.DATABASE_URL ?? "file:data/x-stats.db"

const globalForDb = globalThis as unknown as { xStatsClient?: Client }

// Reuse one connection across dev hot reloads.
const client = globalForDb.xStatsClient ?? createClient({ url: DATABASE_URL })
if (process.env.NODE_ENV !== "production") globalForDb.xStatsClient = client

export const db = drizzle(client, { schema })
export { schema }

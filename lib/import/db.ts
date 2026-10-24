import type { db } from "../db/client"

/** The app DB or an open transaction on it. */
export type Queryable = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

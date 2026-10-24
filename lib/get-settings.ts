import { connection } from "next/server"
import { cache } from "react"

import { readSettings, type AppSettings } from "@/lib/settings"

/** Settings for server components: read per request (the DB changes outside the build), deduped. */
export const getSettings = cache(async (): Promise<AppSettings> => {
  await connection()
  return readSettings()
})

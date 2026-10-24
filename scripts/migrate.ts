import { mkdirSync } from "node:fs"
import { migrate } from "drizzle-orm/libsql/migrator"

mkdirSync("data", { recursive: true })

const { db, DATABASE_URL } = await import("../lib/db/client")

await migrate(db, { migrationsFolder: "./drizzle" })
console.log(`Migrations applied to ${DATABASE_URL}`)

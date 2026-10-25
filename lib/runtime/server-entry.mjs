// Runs Next's standalone server (path in argv[2]) under `xstats start`.
//
// The launcher keeps a pipe open on our stdin. When it closes (the launcher
// is stopping, or died without cleaning up) we trigger Next's own SIGTERM
// shutdown. Windows has no SIGTERM between processes, so this is how the
// server stops gracefully there, and why it never outlives the launcher.
import { pathToFileURL } from "node:url"

const target = process.argv[2]
if (!target) {
  console.error("usage: server-entry.mjs <path to .next/standalone/server.js>")
  process.exit(2)
}

if (process.env.XSTATS_SUPERVISED === "1") {
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    // Next's SIGTERM handler drains requests and exits; exit anyway if it
    // isn't registered yet (still booting) or takes too long.
    if (process.listenerCount("SIGTERM") === 0) process.exit(0)
    setTimeout(() => process.exit(0), 10_000).unref()
    process.emit("SIGTERM", "SIGTERM")
  }
  process.stdin.on("end", stop)
  process.stdin.on("close", stop)
  process.stdin.on("error", stop)
  process.stdin.resume()
}

await import(pathToFileURL(target).href)

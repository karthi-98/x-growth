// CLI entry for release bundles (xstats.js) and autostart. The bootstrap
// runs first: it settles the data folder before lib/paths.ts is evaluated.
import "../bootstrap"

// update and uninstall replace or delete files under data/, which Windows
// refuses while this process holds the database open (libSQL keeps it open
// even after close()). Run them without loading the other commands, which
// may open the database as they load.
const name = process.argv[2]
if (name === "update" || name === "uninstall") await import("../standalone-command")
else await import("../../../cli/xstats")

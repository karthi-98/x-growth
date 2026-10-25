// Worker entry for release bundles (worker.js). Order matters: the bootstrap
// settles the data folder before lib/paths.ts is evaluated.
import "../bootstrap"
import "../../../worker/index"

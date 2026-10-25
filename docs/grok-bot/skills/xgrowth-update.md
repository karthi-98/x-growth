# Skill: `xgrowth-update`

> **To install:** tell the bot "Save the text below the line as a skill named `xgrowth-update`",
> then paste it.

---

## When to use

The user asks to update X Growth, or a sync or `xstats status --json` reports that a newer version
is available. Never update on your own from a routine: an update restarts the app, so the user
chooses when.

## Inputs and approvals

**Needs** (from your state): `cli`, `os`. Stop and say so if either is missing.

**Approvals:** one local command, `xstats update --json`. Before asking, tell the user what it
does: "This downloads the new version, checks it, backs up your database, swaps the app, updates
the database and restarts X Growth. The app is offline for about a minute. If anything fails it
rolls back to the current version."

No X reads.

## Steps

1. Run, with one approval:

   ```
   <cli> update --json
   ```

   It downloads and verifies the release for this OS, backs up the database, replaces the app
   folder (never the data folder), runs migrations, restarts the app, and rolls back if the
   migrations fail. It prints one JSON object with `status`, the old and new versions, and an
   `error` if it failed.

2. **Refresh your skills** after a successful update to a new version. The skills that match a
   release live in the repo at that version's tag:

   ```
   https://raw.githubusercontent.com/karthi-98/x-growth/v<new version>/docs/grok-bot/skills/<skill name>.md
   ```

   Fetch each of the six skills (`install-xgrowth`, `xgrowth-backfill`, `xgrowth-sync`,
   `xgrowth-update`, `xgrowth-doctor`, `xgrowth-inspiration`) on your own computer. Re-save any whose
   text changed, keeping the same name, and tell the user which ones. Fetch only from that address.
   If the tag doesn't exist, keep the current skills and say so.

3. If the update failed, don't retry in the same conversation without asking. Suggest
   `xgrowth-doctor`.

## Validation and output

- Success: "X Growth updated from 0.3.1 to 0.4.0. Database backed up first. Skills refreshed:
  xgrowth-sync." Mention anything the result lists as new or as needing the user.
- Already current: "X Growth is up to date (0.4.0)."
- Rolled back: "The update to 0.4.0 failed (<error>) and X Growth was rolled back to 0.3.1. Your
  data is safe." Then offer `xgrowth-doctor`.
- The command couldn't run (approval expired or denied, computer not reachable): say so; nothing
  changed.

Don't change `next` or any other sync state.

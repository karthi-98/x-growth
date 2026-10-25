# Skill: `xgrowth-update`

> **Source of truth.** Users don't paste this file: their bot saves a short stub
> ([stubs.md](../stubs.md)) and downloads these steps from the release on every run.

---

## When to use

- The weekly **"X Growth update check"** routine runs (trigger `schedule`).
- The user asks to update X Growth.
- An import result or `xstats status --json` reports a newer version.

An update restarts the app for about a minute, so it always waits for the user's approval, even
from the routine. Checking for a new version needs no approval: it happens in your own cloud.

## Inputs and approvals

**Needs** (from your state): `cli`, `os`, `appVersion`. If `cli` or `os` is missing, stop and say
so. If `appVersion` is missing, skip the check in step 1 and go straight to step 2 (the command
itself says whether it's already up to date).

**Approvals:** at most one local command, `xstats update --json`, and only when a newer version
exists.

No X reads.

## Step 1: check for a new version (your computer, no approval)

Read the latest release:

```
GET https://api.github.com/repos/karthi-98/x-growth/releases/latest
```

Take `tag_name` without the leading `v` as `latest`. Compare it with `appVersion` as version
numbers (0.10.0 is newer than 0.9.2).

- **Not newer:** finish here. From the routine, report one line: "X Growth is up to date
  (0.2.0)." From chat, say the same.
- **Newer:** go to step 2.
- **The check fails** (GitHub unreachable, rate limit): from the routine, report "Couldn't check
  for X Growth updates; I'll try again next week." and stop. From chat, offer to try the update
  anyway (step 2), since the command checks for itself.

## Step 2: update (1 approval)

Tell the user what will happen, then ask for one approval:

> "X Growth <latest> is available (you have <appVersion>). Updating downloads and checks the new
> version, backs up your database, swaps the app and restarts it. It's offline for about a minute,
> and it rolls back by itself if anything fails."

Run:

```
<cli> update --json
```

It prints one JSON object with `status`, the old and new versions, and an `error` if it failed.

If the approval expires or is denied, or the computer is off: nothing changed. From the routine,
report "X Growth <latest> is ready to install; say 'update X Growth' when it suits you." The next
weekly check asks again.

## Step 3: after the update

- **Success:** save the new version as `appVersion` in memory and in
  `/workspace/x-growth/state.json`. Your skills follow automatically: they load from the release
  that matches `appVersion` (see **Loading skills** in your instructions).
- **Rolled back or failed:** keep `appVersion` as it was. Don't retry in the same conversation
  without asking. Suggest `xgrowth-doctor`.

## Validation and output

- Success: "X Growth updated from 0.2.0 to 0.3.0. Database backed up first." Mention anything the
  result lists as new or as needing the user.
- Already current: "X Growth is up to date (0.3.0)."
- Rolled back: "The update to 0.3.0 failed (<error>) and X Growth was rolled back to 0.2.0. Your
  data is safe." Then offer `xgrowth-doctor`.
- Not run (approval expired or denied, computer not reachable): say so; nothing changed.

Don't change `next` or any other sync state.

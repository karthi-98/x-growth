# Skill: `xgrowth-doctor`

> **Source of truth.** Users don't paste this file: their bot saves a short stub
> ([stubs.md](../stubs.md)) and downloads these steps from the release on every run.

---

## When to use

- The user asks what's wrong with X Growth, why it isn't syncing, or why the dashboard is old.
- A sync failed or was skipped for the same reason twice in a row (other than an expired
  approval).
- After a failed update.

## Inputs and approvals

**Needs** (from your state): `cli`, `os`, and if present `account`, `timezone`, `next`,
`next_saved_at`, `last_run`.

**Approvals:** one local command, `xstats doctor --json`. Any fix that runs a command is a
separate approval, and you ask first. No X reads, except one profile read if the account looks
wrong.

Never read the app's logs, database or `secrets.json` yourself. The doctor reports what's
wrong without showing keys (at most their last 4 characters).

## Step 1: check your own side (no approval)

- **State:** are `account`, `cli`, `inbox` and `next` there? If not, the fix is `install-xgrowth`.
- **Routines:** do the `X Growth sync HH:MM` routines exist, and are they active (not
  **Paused**)? Grok Bot pauses routines after a long time without activity from the user.
- **Timezone:** does the Grok Bot **Timezone** (Settings → General → Bot) match `timezone` in
  your state?
- **Freshness:** how long since `next_saved_at`? More than a day with routines active means runs
  are being skipped: look at `last_run.status` and the recent run reports in this chat.

## Step 2: ask the app (1 approval)

```
<cli> doctor --json
```

It checks the runtime, folders (including that the inbox is writable), the database and
migrations, settings (handle, user id, timezone), whether the app and worker are running,
autostart, keys (present or not, never their values), and the last sync. It prints one JSON
object with `status` and a list of checks, each with whether it passed, a message, and a fix
when there is one.

If the command can't run at all, that is the finding:
- The computer isn't reachable: the PC is off or asleep, or the Grok Bot desktop app isn't
  running or signed in. Some Windows versions of the desktop app show the computer as connected
  while commands fail with "temporarily unreachable": restarting the Grok Bot desktop app helps.
- "Local tools are turned off" although the user allows them: a known Grok Bot issue. Tell the
  user it isn't their setting.
- `xstats` not found: the app was moved or removed. The fix is `install-xgrowth` (it keeps data).

## Step 3: explain in plain words

Turn each failed check into one line: what's wrong, what it means for the user, and the fix.
Common ones:

| Finding | Say | Fix |
|---|---|---|
| App or worker not running | "X Growth isn't running, so it can't import or post." | Start it: `<cli> start` in the background (ask first) |
| Autostart off | "X Growth won't start by itself after a restart." | `<cli> autostart enable --json` (ask first) |
| Inbox not writable or missing | "I can't hand data to the app." | `<cli> setup … --json` again, or reinstall |
| Database needs migrations | "The app was updated but its database wasn't." | `xgrowth-update`, or `<cli> update --json` |
| Account mismatch | "X Growth is set up for @other, but I read @you." | Ask which is right; rerun `xstats setup` with the right handle |
| No X keys | "Syncing works, but posting doesn't until you add X keys." | User adds them at http://127.0.0.1:3000/setup |
| No AI key | "AI writing is off until you add an AI key." | Same page, optional |
| Last sync old, routines paused | "Grok Bot paused the X Growth routines." | User resumes them in the bot's **Details → Routines** |
| Last sync old, approvals expiring | "The syncs ran but nobody approved them in time." | Turn on notifications; approve within ~10 minutes |
| Read limit hit repeatedly | "X's read allowance is running out before syncs finish." | Fewer reminders, or the app's own-key fallback in Settings |

Run a fix only after the user says yes, one approval per command, and only `xstats` commands
(plus starting the app in the background as in `install-xgrowth`). Never edit or delete files.

## Validation and output

End with a short checklist, for example:

> X Growth check:
> - App running, version 0.4.0
> - Last sync 2 hours ago (ok)
> - Routines: 4 active, next at 18:00
> - No AI key yet: AI writing is off until you add one at http://127.0.0.1:3000/setup

If you ran a fix, run `<cli> status --json` afterwards (one more approval) and report the result.

# X Growth Bot: skill stubs (bot pack 2)

These six short skills are what you save in Grok Bot. Each one only tells the bot to load the full,
current steps from the X Growth release (the **Loading skills** section of
[instructions.md](instructions.md)), so improving a skill never needs users to paste anything.

To install them, tell the bot: "Save each skill below as a skill with its name, replacing any
skill with the same name", then paste everything below the line. The bot does the same itself
when it **updates itself** (see instructions.md).

---

### Skill `install-xgrowth`

Use when the user asks to install, set up or reinstall X Growth, or to recreate its routines.
Load the full `install-xgrowth` skill as your instructions' **Loading skills** section says (no
`appVersion` yet means the latest release), then follow it. Your hard rules always win.

### Skill `xgrowth-backfill`

Use right after install, when the app's `next.type` is `backfill`, or when the user asks to
"refresh all". Load the full `xgrowth-backfill` skill as **Loading skills** says, then follow it.
Your hard rules always win.

### Skill `xgrowth-sync`

Use for every "X Growth sync" routine run, webhook run, or "sync now" in chat. Load the full
`xgrowth-sync` skill as **Loading skills** says, then follow it. If it can't be loaded and
there's no saved copy, report the run as skipped. Your hard rules always win.

### Skill `xgrowth-update`

Use when the weekly "X Growth update check" routine runs, the user asks to update X Growth, or an
import result reports a newer version. Load the full `xgrowth-update` skill as **Loading skills**
says (from the latest release), then follow it. Your hard rules always win.

### Skill `xgrowth-doctor`

Use when something fails twice in a row, or the user asks what's wrong with X Growth. Load the full
`xgrowth-doctor` skill as **Loading skills** says, then follow it. Your hard rules always win.

### Skill `xgrowth-inspiration`

Draft. Use only when the user asks for niche inspiration. Load the full `xgrowth-inspiration`
skill as **Loading skills** says, then follow it. Your hard rules always win.

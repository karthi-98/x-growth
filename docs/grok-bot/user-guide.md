# Getting started with X Growth

X Growth shows how your X account is doing (impressions, followers, your best posts and times)
and helps you write and schedule posts. It runs on **your own computer**. A Grok Bot called the
**X Growth Bot** installs it for you and keeps your numbers fresh a few times a day.

This takes about 15 minutes.

## What you need

- A Grok plan that includes **Grok Bot**, and the **Grok Bot desktop app** on the Windows PC or
  Mac where X Growth will live, signed in.
- To **post** from X Growth: X API keys from the [X developer portal](https://developer.x.com)
  (API key and secret, access token and secret, with read and write access). Posting costs
  about $0.015 per post on X's pay-per-use plan ($0.20 if the post has a link). Reading your
  stats doesn't use these keys.
- To **write with AI** (optional): an API key from xAI, OpenAI, Anthropic or OpenRouter.

You can set up X Growth without keys and add them later. Stats work without them.

## 1. Let Grok Bot use your computer

In the Grok Bot desktop app, open **Settings → Computer → Your computer** and make sure
**Execution on this computer** is **Ask every time** (the default). This lets the bot run
commands on your computer, but only after you approve each one.

## 2. Add the X Growth Bot

1. Open the template link: **<template link>**.
2. Click **Add to Grok Bot**, look over what it includes, and click **Add Bot**.
3. If it asks you to connect X, open **Connect apps**, choose **X**, and sign in.

## 3. Ask it to install X Growth

In the X Growth Bot's chat, type:

> Install X Growth

The bot asks for:
- your **X handle**,
- your **timezone**,
- how many **reminders** a day you want (4 by default, at 8:00, 13:00, 18:00 and 22:00),
- **where to install** it. The default is `%LOCALAPPDATA%\XGrowth` on Windows and
  `~/Library/Application Support/XGrowth` on a Mac. Any folder you can write to works, such as
  `D:\Apps\XGrowth`; a protected folder like `C:\Program Files` doesn't. The app and your data
  both live inside that folder.

Then it asks you to approve a few steps on your computer: checking it, installing the app,
setting it up. Each one shows what it will run. Click **Allow once** for each.

## 4. Paste your keys into the app, not the chat

A page opens at **http://127.0.0.1:3000/setup**. Paste your X keys and AI key there. The page
checks them without posting anything.

**Never paste keys into the Grok Bot chat.** The bot doesn't need them and won't ask. If you
paste one by mistake, delete the message and make a new key at the provider.

## 5. Your first import

While you add your keys, the bot reads your last 90 days of posts from X. It then asks you to
approve one step that hands them to X Growth. After that, open **http://127.0.0.1:3000** to see
your dashboard.

For a busy account this can take a while. If X's read limit is reached partway, the bot says so,
and your regular syncs fetch the rest.

## 6. Reminders

The bot sets up its syncs (4 a day by default) and asks to turn on **notifications**. Say yes.

At each sync time, the bot reads X and then asks you to approve **one** step: "Save the files
to the X Growth inbox and import them". Approve it from your computer or your phone.

- **Approvals expire after about 10 minutes.** If you miss one, that's fine: nothing breaks,
  and the next sync picks up everything that was missed.
- Your computer needs to be **on** for the import step. If it's off, the next sync catches up.
- Each sync posts a one-line summary in the bot's chat, like "Synced at 13:02: 71 posts (9 new),
  3 new mentions. Next sync 18:00."

**Want fewer taps?** You can let these imports run without asking. In Grok Bot, open
**Settings → General → Auto-review** and add an **Allow automatically** rule that covers only
saving files to the X Growth inbox and running `xstats import`. Keep it that narrow. Don't set
**Execution on this computer** to **Always allow**: that would cover every command on your
computer.

## 7. Optional: a "Sync now" button

Ask the bot: "Set up Sync now for X Growth." It creates a webhook routine. Then:

1. In Grok Bot, click the bot's name, open **Details → Routines → X Growth sync now**.
2. In its **Webhook** section, copy **POST to** and **key**.
3. In X Growth, open **Settings → Sync**, and paste them under **Grok Bot webhook**.

Now **Sync now** in X Growth starts a sync right away. You still approve the import in Grok Bot.

## Everyday things to ask the bot

| Say | What happens |
|---|---|
| "Sync X Growth now" | A sync right away |
| "Refresh all X Growth data" | Rereads the last 90 days (updates older posts' numbers) |
| "Update X Growth" | Installs the latest version, after backing up your data |
| "What's wrong with X Growth?" | Runs a check-up and explains any problem |
| "Update yourself from GitHub" | Updates the bot's own instructions (when X Growth says **Update your bot**) |
| "Move the 22:00 sync to 23:30" | Changes a reminder time |

## Updates

- **X Growth** checks for a new version every Sunday at 10:00. If there is one, the bot asks you to
  approve the update once. Your data is backed up first, and a failed update rolls back by itself.
- **The bot's skills** update with X Growth; you don't do anything.
- **The bot's own instructions** rarely change. When they do, X Growth shows **Update your bot**
  and the bot tells you; say "update yourself from GitHub" and confirm.

## Troubleshooting

| You see | What it means | What to do |
|---|---|---|
| X Growth says **"Last synced 3 days ago. Open Grok Bot and resume X Growth routines."** | Grok Bot pauses routines when you haven't used it for a while | In Grok Bot, click the bot's name → **Details → Routines**, and turn each X Growth routine back on. The next sync catches up |
| The approval card says **Expired** | You didn't approve within ~10 minutes | Nothing. The next sync covers it. Turn on notifications so you see them sooner |
| "skipped: computer not reachable" | Your computer was off or asleep, or the Grok Bot app wasn't running | Leave the Grok Bot app running. On Windows, if your PC shows as connected but commands fail as "temporarily unreachable", restart the Grok Bot app |
| "Local tools are turned off" although your setting allows them | A known Grok Bot issue | Not your setting. Try again later |
| "Hit the X read limit" | X's free read allowance ran out for now | Nothing; it resets. If it happens every day, ask for fewer reminders |
| Grok Bot stopped doing anything | Your weekly Grok Bot usage ran out | It resets weekly, or add usage in your Grok Bot billing settings |
| The dashboard doesn't open | X Growth isn't running | Ask the bot "What's wrong with X Growth?", or restart your computer (X Growth starts at login) |
| "set up for a different X account" | X Growth was set up with another handle | Ask the bot to reinstall X Growth with the right handle |

## Privacy

- X Growth and all your data stay on your computer, in a folder of their own.
- Your keys are saved only on your computer. The bot never sees them.
- The bot sees your public X data (posts, numbers, mentions) while it reads them, and remembers
  only what it needs: your handle, account id, timezone and when it last synced.
- The bot only ever writes into X Growth's inbox folder and runs X Growth's own commands, each
  with your approval.

## Removing X Growth

Ask the bot "Uninstall X Growth", or run `xstats uninstall` yourself. Your data folder is kept
unless you add `--purge`. Then delete the X Growth routines in the bot's **Details** tab, or
delete the bot.

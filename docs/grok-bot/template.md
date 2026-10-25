# Publishing the X Growth Bot as a template

Users get the bot from a **template link**. They open it, click **Add to Grok Bot**, and have
their own copy, then ask it to "install X Growth". This page is for whoever publishes that link.

Source: [templates for Grok Bot](https://x.ai/bot/guides/templates-for-grok-bot).

## What a template carries

| Copied | Not copied |
|---|---|
| Instructions | Personal or internal memories (excluded by default) |
| Relevant memories | Custom code and scripts |
| Skills | **Private skills** |
| Routines (may not survive: spike S3) | Non-standard plugins such as MCP servers |
| Specific plugins (the recipient reinstalls them) | Secrets |

That is why the X Growth Bot is only words: the instructions and six skills from this folder.
All code is in the app, which the bot installs from GitHub Releases.

Two consequences:

- **Skills may not come along** if Grok Bot treats them as private skills. The instructions tell
  the bot to re-save any missing skill from
  `https://raw.githubusercontent.com/karthi-98/x-growth/main/docs/grok-bot/skills/<name>.md`.
- **Routines are created by `install-xgrowth`** for each user, with their own times and timezone.
  The template bot has **no routines**, so nothing runs for a new user before install.

## 1. Build a clean template bot

Use a bot made only for the template. **Never publish the bot you use for your own X Growth**:
its memory holds your account id, handle, paths and sync state, and "relevant memories" can be
copied.

1. In Grok Bot, create a new bot named **X Growth Bot**. Short description: "Installs X Growth on
   your computer and keeps your X analytics fresh."
2. Paste [instructions.md](instructions.md) (the part between the lines) into its instructions.
3. Save each skill: in the bot's chat, say "Save the text below as a skill named `<name>`" and
   paste the part of the file below its line. Do this for
   [`install-xgrowth`](skills/install-xgrowth.md), [`xgrowth-backfill`](skills/xgrowth-backfill.md),
   [`xgrowth-sync`](skills/xgrowth-sync.md), [`xgrowth-update`](skills/xgrowth-update.md) and
   [`xgrowth-doctor`](skills/xgrowth-doctor.md). Leave out `xgrowth-inspiration` until Phase 5.
4. Check that all five show in the `/` menu. If one is missing, open **Connect apps**, select the
   connected count next to the title, and enable it for this bot under **Private skills**.
5. Add the **X** app from **Connect apps** if you want the template to list it, so recipients are
   prompted to connect X. (The bot can also read public X data with built-in access; spike S2
   checks which one returns the metrics we need in routines.)
6. Don't create routines, don't install the app from this bot, and don't chat with it about your
   own account. Ask it "What do you remember?" before publishing; the answer should be nothing
   about any user.

## 2. Check it like a user would

Before publishing, add the template from a **second Grok Bot account** (spike S3) and on a clean
Windows PC run the whole [user guide](user-guide.md): install, keys, backfill, routines, one
scheduled run. Record the results in [spikes.md](spikes.md).

## 3. Publish

1. Open the template bot's settings and click **Share as Template** (bottom right). This only
   packages a copy; nothing is public yet.
2. Choose who can use it: **a public link**, not **Team**.
3. Review the template details: the context and integrations listed should be the instructions,
   the five skills, and the X app if you added it. **No memories, no routines, no secrets.**
4. Click **Publish**, then **Copy Link**.

## 4. Point people to it

Put the link in:
- the README's install section and [user-guide.md](user-guide.md) (replace `<template link>`),
- the app's `/setup` page and Settings → Sync ("Set up the X Growth Bot").

## 5. Updating the template

When skills or instructions change (usually with an app release):

1. Update the files here in the same PR as the app change, and tag the release (`v<version>`).
   Installed bots pick up new skills through `xgrowth-update`, which re-saves them from that tag.
2. Update the template bot the same way as in step 1, then **Share as Template** and **Publish**
   again. Check whether the link stays the same (spike S3); if it changes, update every place
   from step 4.
3. Existing users aren't affected by a new template; their bots keep their own copy and refresh
   skills on update.

## Checklist before every publish

- [ ] Template bot is clean: no memories about any user, no routines, no files with user data.
- [ ] Instructions match [instructions.md](instructions.md).
- [ ] Five skills, text matching [skills/](skills/) at the release tag.
- [ ] No keys, tokens, webhook URLs, internal URLs or personal data anywhere in the bot.
- [ ] Added from a second account and tested end to end (S3).
- [ ] Link copied into the README, user guide and the app.

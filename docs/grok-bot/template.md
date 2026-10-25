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

That is why the X Growth Bot is only words: the instructions and six short skill **stubs** from
this folder. The full skills and all code ship with each app release on GitHub, and the bot
downloads them as it runs (**Loading skills** in [instructions.md](instructions.md)).

Two consequences:

- **Skills may not come along** if Grok Bot treats them as private skills. That's harmless: the
  instructions load every skill from the release whether or not its stub is saved.
- **Routines are created by `install-xgrowth`** for each user, with their own times and timezone.
  The template bot has **no routines**, so nothing runs for a new user before install.

## 1. Build a clean template bot

Use a bot made only for the template. **Never publish the bot you use for your own X Growth**:
its memory holds your account id, handle, paths and sync state, and "relevant memories" can be
copied.

1. In Grok Bot, create a new bot named **X Growth Bot**. Short description: "Installs X Growth on
   your computer and keeps your X analytics fresh."
2. Paste [instructions.md](instructions.md) (the part between the lines) into its instructions.
3. Save the skill stubs: in the bot's chat, say "Save each skill below as a skill with its name"
   and paste everything below the line in [stubs.md](stubs.md). Don't paste the full files in
   [skills/](skills/): those are downloaded from the release at run time.
4. Check that the stubs show in the `/` menu. If one is missing, open **Connect apps**, select the
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
   the skill stubs, and the X app if you added it. **No memories, no routines, no secrets.**
4. Click **Publish**, then **Copy Link**.

## 4. Point people to it

Put the link in:
- the README's install section and [user-guide.md](user-guide.md) (replace `<template link>`),
- the app's `/setup` page and Settings → Sync ("Set up the X Growth Bot").

## 5. Updating the template

**A change to a full skill** (anything in [skills/](skills/)): change the file and ship an app
release. Every bot loads skills from the release that matches the installed app, and the weekly
update check moves users to the new release. Nobody pastes anything, and the template doesn't
change.

**A change to the pasted part** ([instructions.md](instructions.md) or [stubs.md](stubs.md)):

1. Change the files and bump `BOT_PACK_VERSION` in `lib/bot-pack.ts` and the **Bot pack version**
   line in instructions.md. Raise `MIN_BOT_PACK_VERSION` too if older bots must stop.
2. Ship an app release. Once a bot imports with an older pack, the app's import result tells it
   so; the bot offers to **update itself** from the release, and the app shows "Update your bot".
3. Update the template bot from the new files, then **Share as Template** and **Publish** again.
   Check whether the link stays the same (spike S3); if it changes, update every place from
   step 4.

## Checklist before every publish

- [ ] Template bot is clean: no memories about any user, no routines, no files with user data.
- [ ] Instructions match [instructions.md](instructions.md).
- [ ] Skill stubs matching [stubs.md](stubs.md), and the **Bot pack version** line matching
      `BOT_PACK_VERSION` in `lib/bot-pack.ts`.
- [ ] No keys, tokens, webhook URLs, internal URLs or personal data anywhere in the bot.
- [ ] Added from a second account and tested end to end (S3).
- [ ] Link copied into the README, user guide and the app.

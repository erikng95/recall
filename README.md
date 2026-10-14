# Recall

A personal knowledge bank for the things you hear and read: podcasts, articles, videos, conversations.
Capture a fact in seconds, have Claude fact-check it, link it to what you already know (like Obsidian), and remember it with spaced repetition.

**App:** https://erikng95.github.io/recall/ (works on Android, desktop, offline)

## What it does

| | |
|---|---|
| **Capture** | Tap **+**, or use **Share → Recall** from any Android app (podcast app, browser, YouTube…). Save as a note or drop it in the **Inbox** to sort later. |
| **Link** | Write `[[Note title]]` to connect ideas; autocomplete helps. Each note shows its links, backlinks, *unlinked mentions* (one-tap link) and a mini graph. **Graph** tab shows everything. |
| **Organize** | Nested topics (e.g. *Health / Sleep*), tags, pinned notes, search (`#tag` works). |
| **Remember** | Wrap a key fact in `==double equals==` and it automatically becomes a fill-in-the-blank flashcard. You can also write cards by hand or ask Claude for them. Reviews use FSRS, a modern spaced-repetition algorithm (Again / Hard / Good / Easy). |
| **Verify** | Every note can carry a fact-check: verdict (Supported, Mostly supported, Mixed, Misleading, False, Unverifiable), confidence, summary and cited sources. When reviewing a card from a disputed note, you get a warning so you don't memorize misinformation. |
| **Ask Claude** | On any note, tap *Fact-check*, *Make cards*, *Organize & link* or *Explain deeper*. Then run `/recall` in Claude Code, or ask Claude in the Claude app on your phone (see [Claude on your phone](#claude-on-your-phone-claudeai-and-the-android-app)), and Claude does the work with web research and syncs it back. |

## Setup on your phone (once)

1. Open **https://erikng95.github.io/recall/** in **Chrome on Android**, then tap ⋮ → **Add to Home screen / Install app**.
   After installing, Recall shows up in Android's **Share** menu.
2. Connect sync so the phone, desktop and Claude all share one vault:
   1. Create a **fine-grained token**: https://github.com/settings/personal-access-tokens/new
      - *Repository access*: **Only select repositories** → `erikng95/recall-vault`
      - *Permissions → Repository permissions → Contents*: **Read and write**
      - Expiration: up to you (e.g. 1 year)
   2. In Recall: **Settings → Sync** → repository `erikng95/recall-vault`, paste the token → **Connect & sync**.
   The token is stored only on that device. Do the same on desktop if you use the app there (or reuse the same token).

Sync is automatic: on open, a few seconds after edits, when you leave the app, and when you're back online. Everything also works offline.

## Using Claude (Claude Code on this PC)

The `recall` MCP server is registered in Claude Code (user scope), so it's available in every session. It reads and writes the same private vault through your `gh` login.

- **`/recall`**: processes the inbox into atomic, linked notes, fact-checks queued claims with web research, writes flashcards, organizes topics.
- MCP prompts: `/mcp__recall__process_inbox`, `/mcp__recall__verify_claims` (add `all` to check everything), `/mcp__recall__do_tasks`, `/mcp__recall__tidy_vault`
- Or just ask, e.g. *"What do I know about sleep?"*, *"Quiz me on my nutrition notes"*, *"Find contradictions in my health notes"*, *"Add a note about X with sources"*.

After Claude finishes, open the app (or tap the sync icon) to pull the changes.

Re-register manually if needed:

```bash
claude mcp add --scope user recall -e RECALL_GITHUB_REPO=erikng95/recall-vault -- node "C:/Users/Erik_/Desktop/app for learn/mcp/src/index.ts"
```

## Claude on your phone (claude.ai and the Android app)

The same Recall tools also run as a **remote MCP server** on Cloudflare Workers (free plan), in `mcp-remote/`. Add it once as a custom connector on claude.ai and it works in the Claude Android app, claude.ai on the web and Claude Desktop, all on your Claude subscription (no API key).

It talks to the vault the same way: `vault.json` in the private `erikng95/recall-vault` repo, with a GitHub token stored as a Worker secret. Every request needs an OAuth sign-in. Claude asks you to approve the connection, then you sign in with GitHub, and **only the GitHub user `erikng95` is accepted**. Anyone else, and any request without a valid token, is refused.

### One-time setup (only you can do these)

Run the commands from the `mcp-remote/` folder.

1. **Cloudflare account.** Sign up for free at https://dash.cloudflare.com/sign-up, then:
   ```bash
   npm --prefix ../mcp install
   ```
   ```bash
   npm install
   ```
   ```bash
   npx wrangler login
   ```
2. **First deploy**, to get the Worker's URL:
   ```bash
   npm run deploy
   ```
   The first time, wrangler may ask you to pick a `workers.dev` subdomain. It prints the URL, like `https://recall-mcp.<your-subdomain>.workers.dev`, which this guide calls **WORKER_URL**. Wrangler also creates the `OAUTH_KV` storage. Sign-in doesn't work yet; the next steps fix that.
3. **GitHub OAuth app** (for signing in): https://github.com/settings/applications/new
   - *Application name*: `Recall MCP` · *Homepage URL*: WORKER_URL
   - *Authorization callback URL*: `WORKER_URL/callback`
   - Register it, copy the **Client ID**, then click **Generate a new client secret** and copy it.
4. **Vault token**: a fine-grained token like the one in [phone setup](#setup-on-your-phone-once) (only `erikng95/recall-vault`, *Contents: Read and write*). You can reuse that one or create a separate one, so you can revoke the Worker's access on its own.
5. **Store the three secrets** on the Worker. Each command prompts you to paste the value; secrets never go into the repo:
   ```bash
   npx wrangler secret put GITHUB_CLIENT_ID
   ```
   ```bash
   npx wrangler secret put GITHUB_CLIENT_SECRET
   ```
   ```bash
   npx wrangler secret put RECALL_GITHUB_TOKEN
   ```
6. **Add the connector**: on https://claude.ai go to **Settings → Connectors → Add custom connector**.
   - *Name*: `Recall` · *URL*: `WORKER_URL/mcp` (the URL must end in `/mcp`)
   - Click **Connect**. A Recall page asks whether Claude may access your vault. Click **Allow**, sign in with GitHub as `erikng95`, and authorize the OAuth app.
7. **On the phone**: connectors belong to your Claude account, so Recall also shows up in the **Claude Android app**. In a chat, turn it on from the tools menu (and turn on web search for fact-checking).

Then ask, for example: *"Process my Recall inbox"*, *"Fact-check the notes queued for verification in Recall"*, *"Do my pending Recall tasks"*, *"Quiz me on my sleep notes"*. Open the Recall app (or tap sync) to see the changes.

### Maintenance

- **Update the server** after changing `mcp/src` or `mcp-remote/`: run `npm run deploy` in `mcp-remote/` again.
- **Revoke access**: remove the connector in claude.ai. To cut off the Worker completely, revoke the vault token on GitHub, or run `npx wrangler delete` to remove the Worker.
- **Stay signed in**: tokens refresh automatically. The connection lapses only after 90 days without use; reconnect from Settings → Connectors.
- **Different owner or vault**: change `ALLOWED_GITHUB_USER` / `RECALL_GITHUB_REPO` in `mcp-remote/wrangler.jsonc` and deploy. Tokens that were already issued stop working as soon as the allowed user changes.
- **Local testing** (optional): copy your secrets into `mcp-remote/.dev.vars` (git-ignored, `NAME=value` lines), create a second GitHub OAuth app with callback `http://localhost:8787/callback`, then run `npm run dev` and use `http://localhost:8787/mcp`.

## Project layout

```
app/         React + TypeScript + Vite PWA (installable, offline, share target)
shared/      Data model, merge/sync logic, wikilinks, cloze extraction (used by app AND mcp)
mcp/         MCP server for Claude Code (Node 24 runs the .ts directly; no build step).
             Its tools, prompts and storage core are shared with mcp-remote.
mcp-remote/  The same MCP server over Streamable HTTP + OAuth on Cloudflare Workers (claude.ai, Android app)
scripts/     Tests for shared logic
.claude/commands/recall.md   the /recall command
```

**Data model:** one JSON vault (`notes`, `topics`, `cards`, `inbox`, `reviews`) stored in IndexedDB on each device and as `vault.json` in the private repo. Records merge one at a time, newest version wins, and deletes are kept as tombstones. Two devices editing different notes never conflict.

**Backups:** Settings → *Back up (JSON)*, or *Export as Markdown* (an Obsidian-compatible zip with frontmatter). The private repo also keeps full history of every sync.

## Development

```bash
npm --prefix app install && npm --prefix mcp install
npm run dev          # app at http://localhost:5173
npm test             # MCP smoke test + shared logic tests
npm run test:remote  # remote server: OAuth + MCP over HTTP, in Node and in workerd (needs npm --prefix mcp-remote install)
npm run build        # production build → app/dist
```

Pushing to `main` deploys the app to GitHub Pages (`.github/workflows/deploy.yml`).

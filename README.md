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
| **Explore** | See what you know: mastery per topic (from your review history), fading topics, cards you keep forgetting, notes missing flashcards, and `[[links]]` to notes you haven't written yet. Browse 60 curated topics or type any subject, and Claude builds a fact-checked starter pack at your level. |
| **Learn effectively** | Spaced repetition (FSRS), topics mixed together during review (interleaving), an optional "type your answer first" mode, practising a note right after writing it, a daily goal and streak, and warnings when a card isn't sticking. |
| **Ask Claude** | On any note, tap *Fact-check*, *Make cards*, *Organize & link* or *Explain deeper*. Then run `/recall` in Claude Code and Claude does the work with web research and syncs it back. |

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
- MCP prompts: `/mcp__recall__process_inbox`, `/mcp__recall__verify_claims` (add `all` to check everything), `/mcp__recall__do_tasks`, `/mcp__recall__tidy_vault`, `/mcp__recall__explore_topic` (starter packs), `/mcp__recall__quiz_me` (Claude quizzes you on your weak spots)
- Or just ask, e.g. *"What do I know about sleep?"*, *"Quiz me on my nutrition notes"*, *"Find contradictions in my health notes"*, *"Add a note about X with sources"*.

After Claude finishes, open the app (or tap the sync icon) to pull the changes.

Re-register manually if needed:

```bash
claude mcp add --scope user recall -e RECALL_GITHUB_REPO=erikng95/recall-vault -- node "C:/Users/Erik_/Desktop/app for learn/mcp/src/index.ts"
```

## Project layout

```
app/      React + TypeScript + Vite PWA (installable, offline, share target)
shared/   Data model, merge/sync logic, wikilinks, cloze extraction (used by app AND mcp)
mcp/      MCP server for Claude Code (Node 24 runs the .ts directly; no build step)
scripts/  Tests for shared logic
.claude/commands/recall.md   the /recall command
```

**Data model:** one JSON vault (`notes`, `topics`, `cards`, `inbox`, `reviews`) stored in IndexedDB on each device and as `vault.json` in the private repo. Records merge one at a time, newest version wins, and deletes are kept as tombstones. Two devices editing different notes never conflict.

**Backups:** Settings → *Back up (JSON)*, or *Export as Markdown* (an Obsidian-compatible zip with frontmatter). The private repo also keeps full history of every sync.

## Development

```bash
npm --prefix app install && npm --prefix mcp install
npm run dev          # app at http://localhost:5173
npm test             # MCP smoke test + shared logic tests
npm run build        # production build → app/dist
```

Pushing to `main` deploys the app to GitHub Pages (`.github/workflows/deploy.yml`).

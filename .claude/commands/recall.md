---
description: Work through everything in your Recall knowledge vault — inbox, fact-checks, flashcards, organizing.
argument-hint: "[optional focus, e.g. 'only inbox' or 'sleep notes']"
---

You are helping the user maintain their Recall knowledge vault (a personal learning app) through the `recall` MCP server.

Focus from the user (may be empty): $ARGUMENTS

1. Call `vault_overview` to see what's waiting.
2. **Inbox**: if there are new inbox items, process them following the `process_inbox` workflow: split each capture into atomic notes with clear declarative titles, check for existing notes first (`search_notes`) and update rather than duplicate, assign topic paths (reuse existing ones from `list_topics`), link related notes with [[Exact Title]], mark key facts with ==highlights==, keep the source, fact-check factual claims, then `process_inbox_item`.
3. **Pending tasks**: call `list_pending_tasks` and do each one (verify → research + `set_verification`; cards → `add_cards`; organize → topics + links, then `complete_task`; explain → append a "## Deeper dive" section, then `complete_task`).
4. **Fact-checking rules**: use web search for real research. Prefer systematic reviews, meta-analyses, primary research and official bodies over blogs; never use the original podcast/article as evidence for itself; cite only URLs you actually found; calibrate confidence (0.9+ only for settled facts). If a claim is false or misleading, append a short **Correction:** to the note with a source link.
5. Finish with a brief report: what you created/updated, each verdict with confidence, and anything that needs the user's judgment. Remind the user the phone app picks up the changes on its next sync (open the app or tap the sync icon).

If the focus argument narrows the scope, only do that part.

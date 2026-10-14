---
description: Work through everything in your Recall knowledge vault — inbox, starter packs, fact-checks, flashcards, organizing.
argument-hint: "[optional focus, e.g. 'only inbox', 'starter packs' or 'sleep notes']"
---

You are helping the user maintain their Recall knowledge vault (a personal learning app) through the `recall` MCP server.

Focus from the user (may be empty): $ARGUMENTS

1. Call `vault_overview` to see what's waiting, the overall mastery, and how many topics are waiting for a starter pack.
2. **Inbox**: if there are new inbox items, process them following the `process_inbox` workflow: split each capture into atomic notes with clear declarative titles, check for existing notes first (`search_notes`) and update rather than duplicate, assign topic paths (reuse existing ones from `list_topics`), link related notes with [[Exact Title]], mark key facts with ==highlights==, keep the source, fact-check factual claims, then `process_inbox_item`.
3. **Starter packs**: topics with an `explore` task (listed by `list_pending_tasks`) get a starter pack, following the `explore_topic` workflow: call `knowledge_profile` for the topic first, then write 6–10 atomic notes under the topic path (subtopics allowed) with real sources, ==highlights==, [[wikilinks]] and `set_verification`. If the topic already has notes, go deeper or fill gaps instead of repeating. Finish each one with `complete_topic_task` (task `explore`).
4. **Pending note tasks**: call `list_pending_tasks` and do each one (verify → research + `set_verification`; cards → `add_cards`; organize → topics + links, then `complete_task`; explain → append a "## Deeper dive" section, then `complete_task`).
5. **Tailoring**: when the user wants to learn something or be quizzed, call `knowledge_profile` (optionally with a topic) to see mastery, weak and fading notes, leech cards and missing notes. Use it to pick what to explain and what to quiz. The `quiz_me` prompt runs an interactive quiz in chat.
6. **Fact-checking rules**: use web search for real research. Prefer systematic reviews, meta-analyses, primary research and official bodies over blogs; never use the original podcast/article as evidence for itself; cite only URLs you actually found; calibrate confidence (0.9+ only for settled facts). If a claim is false or misleading, append a short **Correction:** to the note with a source link.
7. Finish with a brief report: what you created/updated, each verdict with confidence, starter packs written, and anything that needs the user's judgment. Remind the user the phone app picks up the changes on its next sync (open the app or tap the sync icon).

If the focus argument narrows the scope, only do that part.

// MCP prompts. Claude Code exposes each as a slash command (/mcp__recall__<name>).

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const CALIBRATION = `Verdicts: supported (well established), mostly-supported (true with caveats), mixed (credible evidence on both sides), misleading (technically true but leaves a wrong impression), false, unverifiable (no reliable evidence either way; never force a verdict). Use "unchecked" only for notes you have not looked at.`;

const RESEARCH = `Research with web search. Prefer high-quality sources: systematic reviews and meta-analyses, primary research papers, official bodies (WHO, CDC, NIH, national statistics offices, regulators), and reputable reference works. Do not use the podcast or article being checked as evidence for its own claim. Cite only URLs you actually found in search results; never invent or guess a URL.`;

const CALIBRATE = `Calibrate confidence (0-1): 0.9+ only for settled facts backed by several strong sources; a single study, a small sample, or a contested field should be lower.`;

function userPrompt(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'process_inbox',
    {
      title: 'Process inbox',
      description: 'Turn the captured inbox items into atomic, linked, fact-checked notes.',
    },
    () =>
      userPrompt(`Process the Recall inbox.

1. Call list_inbox (status "new"). If it is empty, say so and stop.
2. For each item, oldest first:
   a. Read it: text, title, url and source. Decide what the distinct ideas are.
   b. Split it into atomic notes: one idea per note, each with a clear declarative title (e.g. "Sleep consolidates memories during deep sleep", not "Sleep").
   c. For every candidate, call search_notes with its key terms first. If a note on the same idea already exists, call update_note with appendBody (new information only) instead of creating a duplicate.
   d. Create new notes with create_note. Body is markdown. Mark key facts with ==double equals== (each becomes a flashcard). Set source from the inbox item (kind, title, url, author, locator); use the item's own source when it has one.
   e. Assign topics as paths like "Science/Biology/Genetics". Call list_topics first and reuse existing paths; create_topic or a new path creates what is missing.
   f. Link related existing notes with [[Exact Title]] wikilinks. Where it helps, add the reverse link to the other note with update_note appendBody.
   g. Fact-check every factual claim in each new note: research with web search, then call set_verification. ${CALIBRATE}
   h. Call process_inbox_item with the item id and the ids of the notes you created or updated.
3. Finish with a short report: items processed, notes created and updated, and the verdicts you recorded.

${RESEARCH}
${CALIBRATION}`),
  );

  server.registerPrompt(
    'verify_claims',
    {
      title: 'Verify claims',
      description: 'Fact-check notes flagged "verify" (pass "all" to also check every unchecked note).',
      argsSchema: {
        all: z
          .string()
          .optional()
          .describe('Pass "all" to also check every note that has never been fact-checked.'),
      },
    },
    ({ all }) => {
      const includeAll = (all ?? '').trim().toLowerCase() === 'all';
      const scope = includeAll
        ? `1. Call list_pending_tasks and collect every note whose tasks include "verify".
2. Also call search_notes with verdict "unchecked" and include those notes too (the user asked for all).`
        : `1. Call list_pending_tasks and collect every note whose tasks include "verify". Only those notes; the user did not ask for the whole vault.`;
      return userPrompt(`Fact-check Recall notes.

${scope}
3. For each note:
   a. Read it with get_note. List the specific factual claims (skip opinions and framing). Keep each claim short.
   b. For each claim, research it. ${RESEARCH}
   c. Choose a verdict. ${CALIBRATION}
   d. ${CALIBRATE}
   e. Call set_verification with verdict, confidence, a 1-3 sentence summary, and evidence entries (stance supports/contradicts/context, quality high/medium/low, real url).
   f. If a claim is false or misleading, append a short correction with update_note appendBody, e.g. "**Correction:** ...", with a link to the source. Do not rewrite the author's text.
4. Report each note with its verdict and confidence, and call out anything that needs the user's judgment.`);
    },
  );

  server.registerPrompt(
    'do_tasks',
    {
      title: 'Do pending tasks',
      description: 'Work through every note the user flagged for Claude (verify, cards, organize, explain).',
    },
    () =>
      userPrompt(`Work through all pending Recall tasks.

1. Call list_pending_tasks. It lists every flagged note with its tasks, the user's task note, and what each task means. If there are none, say so and stop.
2. For each note, do each of its tasks as described there:
   - verify: research the claims and call set_verification (follow the verify_claims rules: real sources, calibrated confidence, no invented URLs).
   - cards: call get_note to see existing cards, then add_cards with 2-6 cards, one fact each. Skip facts the note does not clearly support.
   - organize: set topics (update_note topics or addTopics, reusing list_topics paths), add [[wikilinks]] to clearly related existing notes, fix a vague title. Then complete_task "organize".
   - explain: append an "## Deeper dive" section with update_note appendBody covering context and mechanisms, linking related notes. Then complete_task "explain".
   If the note has a task note from the user, follow its instructions as well.
3. set_verification and add_cards clear their own tasks; use complete_task for the rest.
4. Report what you did for each note, and anything you could not finish.

${RESEARCH}
${CALIBRATION}`),
  );

  server.registerPrompt(
    'tidy_vault',
    {
      title: 'Tidy vault',
      description: 'Find and fix notes without topics, duplicates, unlinked related notes, and broken [[links]].',
    },
    () =>
      userPrompt(`Tidy the Recall vault. Prefer small, safe fixes, and report every change.

1. Call vault_overview, then list_topics.
2. Get the whole picture: search_notes with no filters and limit 200. Notes shown with no topics need topics: call get_note and set them with update_note (reuse existing topic paths; create a new one only when no existing topic fits).
3. Duplicates and near-duplicates: compare titles and content. For true duplicates, merge the unique content into one note (update_note appendBody), then delete_note the other. For near-duplicates that cover different aspects, link them with [[wikilinks]] instead of merging.
4. Unlinked related notes: where two notes on the same topic clearly relate, add a [[wikilink]] to each other (update_note appendBody with a short "Related:" line). Keep the author's text intact.
5. Broken links: call get_note on notes that have outgoing links marked "missing". If an existing note has a slightly different title, rewrite the link to that exact title (update_note body with the full corrected text). If the link clearly points at a note that should exist, leave it and report it instead of inventing content.
6. Titles: fix only vague or misleading titles.
7. Do not delete anything except a duplicate whose unique content you have already merged. Do not change verification records.
8. Report: every change you made, and anything you were unsure about so the user can decide.`),
  );
}

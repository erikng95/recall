// MCP tools exposed to Claude. Read tools fetch the vault; write tools go through storage.mutate.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  live,
  newId,
  normalizeTitle,
  renameLinksInBody,
  titleIndex,
  type Card,
  type ClaudeTask,
  type ID,
  type InboxItem,
  type Note,
  type Vault,
} from '../../shared/vault.ts';
import { vaultKnowledge } from '../../shared/knowledge.ts';
import { StorageConfigError, type Storage } from './storage.ts';
import {
  QUALITY_VALUES,
  RecallError,
  SOURCE_KIND_VALUES,
  STANCE_VALUES,
  TASK_VALUES,
  TOPIC_TASK_VALUES,
  VERDICT_VALUES,
  appendMarkdown,
  cardsOf,
  clearTasks,
  clearTopicTasks,
  effectiveVerdict,
  fail,
  getOwn,
  liveNote,
  liveTopic,
  makeVerification,
  normalizeTags,
  now,
  resolveNote,
  resolveTopicList,
  resolveTopicRef,
  topicPath,
  topicSubtree,
  topicTreeLines,
} from './model.ts';
import {
  formatKnowledgeProfile,
  formatNote,
  formatPendingHeader,
  formatPendingNote,
  formatPendingTopic,
  formatPendingTopicHeader,
  iso,
  noteListItem,
  verdictLabel,
} from './format.ts';

// ---------- zod schemas ----------

const verdictSchema = z
  .enum(VERDICT_VALUES)
  .describe('One of: supported, mostly-supported, mixed, misleading, false, unverifiable (unchecked = not checked yet).');

const sourceSchema = z
  .object({
    kind: z.enum(SOURCE_KIND_VALUES).describe('Where the claim came from.'),
    title: z.string().optional().describe('Episode / article / book title.'),
    url: z.string().optional().describe('Link to the source, if known.'),
    author: z.string().optional().describe('Host, author or speaker.'),
    locator: z.string().optional().describe('Timestamp ("12:30"), page or chapter.'),
  })
  .describe('Where the material came from.');

const evidenceSchema = z.object({
  title: z.string().min(1).describe('Title of the source (paper, agency page, article).'),
  url: z.url().optional().describe('Real URL you actually found via web search. Never invent one.'),
  stance: z.enum(STANCE_VALUES).describe('supports, contradicts, or context.'),
  note: z.string().optional().describe('One line on what this source says about the claim.'),
  quality: z.enum(QUALITY_VALUES).optional().describe('high = systematic review / primary research / official body.'),
});

const verificationInputSchema = z.object({
  verdict: verdictSchema,
  confidence: z.number().min(0).max(1).optional().describe('0-1, calibrated.'),
  summary: z.string().optional().describe('1-3 sentences explaining the verdict.'),
  evidence: z.array(evidenceSchema).optional(),
});

const taskSchema = z.enum(TASK_VALUES).describe('verify | cards | organize | explain');
const topicTaskSchema = z.enum(TOPIC_TASK_VALUES).describe('explore = write a starter pack for the topic.');

// ---------- result helpers ----------

function ok(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(err: unknown): CallToolResult {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: msg }], isError: true };
}

async function run(fn: () => Promise<string> | string): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    // Expected problems (RecallError, config) go back to Claude as-is; anything else is logged for the operator.
    if (!(err instanceof RecallError) && !(err instanceof StorageConfigError)) console.error('[recall-mcp] tool error:', err);
    return errorResult(err);
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ---------- registration ----------

export function registerTools(server: McpServer, storage: Storage): void {
  // ===== Read tools =====

  server.registerTool(
    'vault_overview',
    {
      title: 'Vault overview',
      description:
        'Start here. Summarizes the Recall vault: counts of notes, topics, flashcards (and how many are due now), ' +
        'new inbox items, notes with pending Claude tasks, topics waiting for a starter pack, and notes never fact-checked, ' +
        'then overall mastery (what the user knows, from flashcard scheduling) and the topic tree with note counts. Read-only.',
      inputSchema: {},
    },
    () =>
      run(async () => {
        const v = await storage.read();
        const t = now();
        const notes = live(v.notes);
        const topics = live(v.topics);
        const cards = live(v.cards);
        const inbox = live(v.inbox).filter((i) => i.status === 'new');
        const pending = notes.filter((n) => (n.tasks?.length ?? 0) > 0);
        const pendingTopics = topics.filter((tp) => (tp.tasks?.length ?? 0) > 0);
        const unchecked = notes.filter((n) => !n.verification || n.verification.verdict === 'unchecked');
        const due = cards.filter((c) => !c.suspended && (!c.srs || c.srs.due <= t));
        const knowledge = vaultKnowledge(v, t);

        const lines = [
          `Vault: ${storage.describe()}`,
          `Notes: ${notes.length}`,
          `Topics: ${topics.length}`,
          `Flashcards: ${cards.length} (due now: ${due.length})`,
          `Overall mastery: ${knowledge.mastery}% (${knowledge.label})`,
          `New inbox items: ${inbox.length}`,
          `Notes with pending Claude tasks: ${pending.length}`,
          `Topics with pending tasks: ${pendingTopics.length}`,
          `Notes never fact-checked: ${unchecked.length}`,
          '',
          'Topic tree (note counts are direct, not including subtopics):',
          ...(topics.length ? topicTreeLines(v) : ['  (no topics yet)']),
        ];
        const next: string[] = [];
        if (inbox.length) next.push('Next: list_inbox to see captured items, or run the process_inbox prompt.');
        if (pendingTopics.length) next.push('Next: list_pending_tasks, or run the explore_topic prompt to write starter packs.');
        if (pending.length) next.push('Next: list_pending_tasks, or run the do_tasks prompt.');
        if (next.length) lines.push('', ...next);
        return lines.join('\n');
      }),
  );

  server.registerTool(
    'list_topics',
    {
      title: 'List topics',
      description:
        'The topic tree with ids, emoji, descriptions and note counts. Topics are addressed by path ("Science/Biology/Genetics") ' +
        'or id in other tools. Use this before assigning topics so you reuse existing ones.',
      inputSchema: {},
    },
    () =>
      run(async () => {
        const v = await storage.read();
        const count = live(v.topics).length;
        if (!count) return 'No topics yet. create_topic makes one; create_note and update_note also accept new topic paths.';
        return [`${plural(count, 'topic')}:`, ...topicTreeLines(v, { ids: true, descriptions: true })].join('\n');
      }),
  );

  server.registerTool(
    'search_notes',
    {
      title: 'Search notes',
      description:
        'Find notes by text, topic, tag or verdict. query matches title, body and tags (case-insensitive substring). ' +
        'topic accepts a path or id and includes subtopics. Returns JSON with id, title, topics, tags, verdict and a short snippet. ' +
        'Always search before create_note so you update an existing note instead of duplicating it.',
      inputSchema: {
        query: z.string().optional().describe('Text to look for in title, body or tags.'),
        topic: z.string().optional().describe('Topic path or id; includes subtopics.'),
        tag: z.string().optional().describe('Exact tag (case-insensitive).'),
        verdict: verdictSchema.optional(),
        limit: z.number().int().min(1).max(200).optional().describe('Default 30.'),
      },
    },
    (args) =>
      run(async () => {
        const v = await storage.read();
        const subtree = args.topic ? topicSubtreeFor(v, args.topic) : undefined;
        const q = args.query?.trim().toLowerCase() || undefined;
        const tag = args.tag?.trim().replace(/^#+/, '').toLowerCase() || undefined;

        const matches = live(v.notes)
          .filter((n) => {
            if (subtree && !n.topicIds.some((t) => subtree.has(t))) return false;
            if (q) {
              const hit =
                n.title.toLowerCase().includes(q) ||
                n.body.toLowerCase().includes(q) ||
                n.tags.some((t) => t.toLowerCase().includes(q));
              if (!hit) return false;
            }
            if (tag && !n.tags.some((t) => t.toLowerCase() === tag)) return false;
            if (args.verdict && effectiveVerdict(n) !== args.verdict) return false;
            return true;
          })
          .sort((a, b) => b.updatedAt - a.updatedAt);

        const limit = args.limit ?? 30;
        const results = matches.slice(0, limit).map((n) => noteListItem(v, n, q));
        return JSON.stringify({ totalMatches: matches.length, shown: results.length, results }, null, 2);
      }),
  );

  server.registerTool(
    'get_note',
    {
      title: 'Get note',
      description:
        'Full view of one note: body (markdown with [[wikilinks]] and ==key facts==), source, verification with evidence, pending tasks, ' +
        'topics, outgoing links (resolved or missing), backlinks, and its flashcards. Give either id or title.',
      inputSchema: {
        id: z.string().optional(),
        title: z.string().optional().describe('Case-insensitive exact title.'),
      },
    },
    (args) =>
      run(async () => {
        const v = await storage.read();
        return formatNote(v, resolveNote(v, args));
      }),
  );

  server.registerTool(
    'list_inbox',
    {
      title: 'List inbox',
      description:
        'Captured items from the phone (raw text from podcasts/articles, with url and source). Default shows status "new" only, oldest first. ' +
        'Process each one with the process_inbox prompt, then call process_inbox_item.',
      inputSchema: {
        status: z.enum(['new', 'done', 'all']).optional().describe('Default "new".'),
      },
    },
    (args) =>
      run(async () => {
        const v = await storage.read();
        const status = args.status ?? 'new';
        const items = live(v.inbox)
          .filter((i) => status === 'all' || i.status === status)
          .sort((a, b) => a.createdAt - b.createdAt);
        return JSON.stringify(
          {
            count: items.length,
            items: items.map((i: InboxItem) => ({
              id: i.id,
              status: i.status,
              title: i.title,
              text: i.text,
              url: i.url,
              source: i.source,
              createdAt: iso(i.createdAt),
              noteIds: i.noteIds ?? [],
            })),
          },
          null,
          2,
        );
      }),
  );

  server.registerTool(
    'list_pending_tasks',
    {
      title: 'List pending tasks',
      description:
        'Everything the user has flagged for Claude. Notes with tasks (verify, cards, organize, explain) come with their full body, source, ' +
        'existing verification and the user\'s task note. Topics with an explore task (a starter pack request) come with their level, ' +
        'task note, existing notes and a knowledge summary. Explains what each task means. Start here for the do_tasks and explore_topic workflows.',
      inputSchema: {},
    },
    () =>
      run(async () => {
        const v = await storage.read();
        const pending = live(v.notes)
          .filter((n) => (n.tasks?.length ?? 0) > 0)
          .sort((a, b) => a.createdAt - b.createdAt);
        const pendingTopics = live(v.topics)
          .filter((t) => (t.tasks?.length ?? 0) > 0)
          .sort((a, b) => a.createdAt - b.createdAt);
        if (!pending.length && !pendingTopics.length) return 'No pending tasks. Nothing is flagged for Claude.';

        const sections: string[] = [];
        if (pending.length) {
          sections.push([formatPendingHeader(pending.length), ...pending.map((n) => formatPendingNote(v, n))].join('\n\n'));
        }
        if (pendingTopics.length) {
          sections.push(
            [formatPendingTopicHeader(pendingTopics.length), ...pendingTopics.map((t) => formatPendingTopic(v, t))].join('\n\n'),
          );
        }
        return sections.join('\n\n---\n\n');
      }),
  );

  server.registerTool(
    'knowledge_profile',
    {
      title: 'Knowledge profile',
      description:
        'What the user knows, from their flashcard history: overall and per-topic mastery (0-100%, with a label), note and card counts, ' +
        'cards due now, mature, fading (recall under 80%) and leech cards, recall right now, retention over the last 30 days, review streak, ' +
        'reviews today; then the weakest notes, leech cards, notes without flashcards and missing notes (linked but not written). ' +
        'Read-only. Use it to tailor explanations to what the user already knows, to decide what to quiz (see the quiz_me prompt), and to suggest what to learn next. ' +
        'Pass a topic to limit everything to that topic and its subtopics.',
      inputSchema: {
        topic: z.string().optional().describe('Topic id or path, e.g. "Science/Biology". Default: whole vault. Includes subtopics.'),
        limit: z.number().int().min(1).max(50).optional().describe('Max items per list. Default 10.'),
      },
    },
    (args) =>
      run(async () => {
        const v = await storage.read();
        let scopeId: ID | undefined;
        if (args.topic !== undefined) {
          scopeId = resolveTopicRef(v, args.topic, false);
          if (!scopeId) fail(`Topic "${args.topic}" not found. Use list_topics to see valid paths and ids.`);
        }
        return formatKnowledgeProfile(v, scopeId, args.limit ?? 10, now());
      }),
  );

  // ===== Write tools =====

  server.registerTool(
    'create_note',
    {
      title: 'Create note',
      description:
        'Create a new note. Title must be a clear declarative statement, one idea per note (e.g. "Sleep consolidates memories during deep sleep"). ' +
        'Body is markdown: link related notes with [[Exact Title]], and mark the key facts with ==double equals== (the app turns each into a flashcard). ' +
        'Topics are paths like "Science/Biology/Genetics" (created if missing). Fails if a note with the same title already exists; search first. ' +
        'Pass verification only when you actually checked the claims.',
      inputSchema: {
        title: z.string().min(1).max(200),
        body: z.string().describe('Markdown body. Use [[Title]] links and ==key facts==.'),
        topics: z.array(z.string()).optional().describe('Topic paths or ids.'),
        tags: z.array(z.string()).optional(),
        source: sourceSchema.optional(),
        verification: verificationInputSchema.optional(),
      },
    },
    (args) =>
      run(() =>
        storage.mutate((v) => {
          const title = args.title.trim();
          if (!title) fail('Title cannot be empty.');
          const existing = titleIndex(v).get(normalizeTitle(title));
          if (existing) {
            fail(
              `A note titled "${existing.title}" already exists (id ${existing.id}). ` +
                'Use update_note with that id to add to it instead of creating a duplicate.',
            );
          }
          const t = now();
          const topicIds = resolveTopicList(v, args.topics ?? [], true);
          const note: Note = {
            id: newId(),
            title,
            body: args.body,
            topicIds,
            tags: normalizeTags(args.tags ?? []),
            createdAt: t,
            updatedAt: t,
            ...(args.source ? { source: args.source } : {}),
            ...(args.verification
              ? {
                  verification: makeVerification(
                    {
                      verdict: args.verification.verdict,
                      confidence: args.verification.confidence,
                      summary: args.verification.summary,
                      evidence: args.verification.evidence,
                    },
                    t,
                  ),
                }
              : {}),
          };
          v.notes[note.id] = note;
          const where = topicIds.length ? ` in ${topicIds.map((id) => topicPath(v, id)).join(', ')}` : '';
          return `Created note "${title}" (id ${note.id})${where}.`;
        }, `Claude: create note "${args.title.trim()}"`),
      ),
  );

  server.registerTool(
    'update_note',
    {
      title: 'Update note',
      description:
        'Edit a note. body REPLACES the whole body (get_note first and send the full text); appendBody adds to the end after a blank line (use this for corrections, deeper dives, related links). ' +
        'topics replaces all topics; addTopics adds some. tags replaces tags. Changing the title rewrites [[Old Title]] links in every other note automatically. ' +
        'Only fields you pass are changed.',
      inputSchema: {
        id: z.string(),
        title: z.string().min(1).max(200).optional(),
        body: z.string().optional().describe('Replaces the whole body.'),
        appendBody: z.string().optional().describe('Appended after a blank line.'),
        topics: z.array(z.string()).optional().describe('Replaces all topics (paths or ids).'),
        addTopics: z.array(z.string()).optional().describe('Adds topics (paths or ids).'),
        tags: z.array(z.string()).optional().describe('Replaces all tags.'),
        source: sourceSchema.optional(),
      },
    },
    (args) =>
      run(() =>
        storage.mutate((v) => {
          const note = liveNote(v, args.id);
          const t = now();
          const changes: string[] = [];
          const renamedIn: string[] = [];

          if (args.title !== undefined) {
            const newTitle = args.title.trim();
            if (!newTitle) fail('Title cannot be empty.');
            const clash = titleIndex(v).get(normalizeTitle(newTitle));
            if (clash && clash.id !== note.id) {
              fail(`Another note is already titled "${clash.title}" (id ${clash.id}).`);
            }
            if (newTitle !== note.title) {
              const oldTitle = note.title;
              note.title = newTitle;
              note.body = renameLinksInBody(note.body, oldTitle, newTitle);
              for (const other of live(v.notes)) {
                if (other.id === note.id) continue;
                const rewritten = renameLinksInBody(other.body, oldTitle, newTitle);
                if (rewritten !== other.body) {
                  other.body = rewritten;
                  other.updatedAt = t;
                  renamedIn.push(other.title);
                }
              }
              changes.push(`title "${oldTitle}" → "${newTitle}"`);
            }
          }

          if (args.body !== undefined) {
            note.body = args.body;
            changes.push('body replaced');
          }
          if (args.appendBody !== undefined && args.appendBody.trim()) {
            note.body = appendMarkdown(note.body, args.appendBody);
            changes.push('appended to body');
          }

          if (args.topics !== undefined) {
            note.topicIds = resolveTopicList(v, args.topics, true);
            changes.push('topics replaced');
          }
          if (args.addTopics?.length) {
            const added = resolveTopicList(v, args.addTopics, true);
            for (const id of added) if (!note.topicIds.includes(id)) note.topicIds.push(id);
            changes.push(`added topics ${added.map((id) => topicPath(v, id)).join(', ')}`);
          }

          if (args.tags !== undefined) {
            note.tags = normalizeTags(args.tags);
            changes.push('tags replaced');
          }
          if (args.source !== undefined) {
            note.source = args.source;
            changes.push('source set');
          }

          if (changes.length === 0) return `No changes to "${note.title}".`;
          note.updatedAt = t;
          const lines = [`Updated "${note.title}" (id ${note.id}): ${changes.join('; ')}.`];
          if (renamedIn.length) lines.push(`Rewrote links to the new title in: ${renamedIn.join(', ')}.`);
          return lines.join('\n');
        }, `Claude: update note ${args.id}`),
      ),
  );

  server.registerTool(
    'set_verification',
    {
      title: 'Set verification',
      description:
        'Record your fact-check of a note. Do real research first: use web search, prefer high-quality sources (systematic reviews, meta-analyses, ' +
        'primary research, official bodies like WHO/CDC/NIH or national statistics offices), and cite only URLs you actually found. ' +
        'Verdicts: supported (well established), mostly-supported (true with caveats), mixed (credible evidence on both sides), ' +
        'misleading (technically true but wrong impression), false, unverifiable (no reliable evidence either way; do not force a verdict). ' +
        'Calibrate confidence 0-1: 0.9+ only for settled facts with several strong sources; a single study or contested topic should be lower. ' +
        'Clears the "verify" task. If a claim is false or misleading, also add a short correction with update_note appendBody.',
      inputSchema: {
        noteId: z.string(),
        verdict: verdictSchema,
        confidence: z.number().min(0).max(1).describe('0-1, calibrated.'),
        summary: z.string().min(1).describe('1-3 sentences: what is claimed, what the evidence says.'),
        evidence: z.array(evidenceSchema).describe('Sources you found. Empty only for unverifiable.'),
      },
    },
    (args) =>
      run(() =>
        storage.mutate((v) => {
          const note = liveNote(v, args.noteId);
          const t = now();
          note.verification = makeVerification(
            {
              verdict: args.verdict,
              confidence: args.confidence,
              summary: args.summary,
              evidence: args.evidence,
            },
            t,
          );
          clearTasks(note, ['verify']);
          note.updatedAt = t;
          return `Recorded ${verdictLabel(args.verdict)} (confidence ${args.confidence}) for "${note.title}" with ${plural(args.evidence.length, 'source')}. "verify" task cleared.`;
        }, `Claude: verify "${args.noteId}"`),
      ),
  );

  server.registerTool(
    'add_cards',
    {
      title: 'Add flashcards',
      description:
        'Create 1-10 flashcards for a note. Each card tests ONE fact: question on the front, concise answer on the back, both in plain markdown. ' +
        'Mix plain factual recall cards (what, which, how many) with a few "why" or "how" elaboration cards that test understanding ' +
        '(e.g. "Why does cold exposure raise heart rate?"). Keep one idea per card. ' +
        'Skip anything the note does not clearly support. Check get_note first so you do not duplicate existing cards. Clears the "cards" task.',
      inputSchema: {
        noteId: z.string(),
        cards: z
          .array(
            z.object({
              front: z.string().min(1).describe('Question, one fact.'),
              back: z.string().min(1).describe('Concise answer.'),
            }),
          )
          .min(1)
          .max(10),
      },
    },
    (args) =>
      run(() =>
        storage.mutate((v) => {
          const note = liveNote(v, args.noteId);
          const t = now();
          for (const c of args.cards) {
            const card: Card = {
              id: newId(),
              noteId: note.id,
              kind: 'basic',
              front: c.front.trim(),
              back: c.back.trim(),
              createdBy: 'claude',
              createdAt: t,
              updatedAt: t,
            };
            v.cards[card.id] = card;
          }
          clearTasks(note, ['cards']);
          note.updatedAt = t;
          return `Added ${plural(args.cards.length, 'flashcard')} to "${note.title}". "cards" task cleared if it was pending.`;
        }, `Claude: add ${args.cards.length} card(s) to ${args.noteId}`),
      ),
  );

  server.registerTool(
    'complete_task',
    {
      title: 'Complete task',
      description:
        'Clear one pending task from a note without other changes (use it after "organize" or "explain" work; set_verification and add_cards already clear their own tasks). ' +
        'Clears the task note too once no tasks remain.',
      inputSchema: {
        noteId: z.string(),
        task: taskSchema,
      },
    },
    (args) =>
      run(() =>
        storage.mutate((v) => {
          const note = liveNote(v, args.noteId);
          const task: ClaudeTask = args.task;
          if (!clearTasks(note, [task])) {
            return `"${task}" was not pending on "${note.title}". Nothing changed.`;
          }
          note.updatedAt = now();
          const left = note.tasks ?? [];
          return `Cleared "${task}" on "${note.title}". Remaining tasks: ${left.length ? left.join(', ') : 'none'}.`;
        }, `Claude: complete ${args.task} on ${args.noteId}`),
      ),
  );

  server.registerTool(
    'complete_topic_task',
    {
      title: 'Complete topic task',
      description:
        'Clear a pending topic task after its work is done: "explore" once the starter pack is written (see the explore_topic prompt). ' +
        'Clears the topic task note too once no tasks remain. Pass the topic id or path.',
      inputSchema: {
        topicId: z.string().describe('Topic id or path.'),
        task: topicTaskSchema,
      },
    },
    (args) =>
      run(() =>
        storage.mutate((v) => {
          const id = resolveTopicRef(v, args.topicId, false);
          const topic = id ? liveTopic(v, id) : undefined;
          if (!topic) fail(`No topic "${args.topicId}". Use list_topics to see valid paths and ids.`);
          const path = topicPath(v, topic.id);
          if (!clearTopicTasks(topic, [args.task])) {
            return `"${args.task}" was not pending on "${path}". Nothing changed.`;
          }
          topic.updatedAt = now();
          const left = topic.tasks ?? [];
          return `Cleared "${args.task}" on topic "${path}". Remaining topic tasks: ${left.length ? left.join(', ') : 'none'}.`;
        }, `Claude: complete topic ${args.task} on ${args.topicId}`),
      ),
  );

  server.registerTool(
    'create_topic',
    {
      title: 'Create topic',
      description:
        'Find or create a topic by path, e.g. "Science/Biology/Genetics". Each segment is matched case-insensitively under its parent and created if missing. ' +
        'Returns the topic id. Optional emoji and description are applied to the last topic in the path.',
      inputSchema: {
        path: z.string().min(1),
        emoji: z.string().max(16).optional(),
        description: z.string().max(500).optional(),
      },
    },
    (args) =>
      run(() =>
        storage.mutate((v) => {
          const id = resolveTopicRef(v, args.path, true);
          if (!id) fail(`Could not create topic "${args.path}".`);
          const topic = liveTopic(v, id);
          if (!topic) fail(`Topic "${args.path}" is missing.`);
          const t = now();
          let changed = false;
          if (args.emoji !== undefined && topic.emoji !== args.emoji) {
            topic.emoji = args.emoji;
            changed = true;
          }
          if (args.description !== undefined && topic.description !== args.description) {
            topic.description = args.description;
            changed = true;
          }
          if (changed) topic.updatedAt = t;
          return `Topic "${topicPath(v, id)}" ready (id ${id}).`;
        }, `Claude: topic ${args.path}`),
      ),
  );

  server.registerTool(
    'process_inbox_item',
    {
      title: 'Mark inbox item processed',
      description:
        'Mark a captured inbox item as done after its content has been turned into notes. Pass the ids of the notes you created or updated from it.',
      inputSchema: {
        id: z.string(),
        noteIds: z.array(z.string()).optional(),
      },
    },
    (args) =>
      run(() =>
        storage.mutate((v) => {
          const item = getOwn(v.inbox, args.id);
          if (!item || item.deleted) fail(`No inbox item with id "${args.id}". Use list_inbox to see valid ids.`);
          const noteIds = args.noteIds ?? [];
          for (const nid of noteIds) liveNote(v, nid);
          item.status = 'done';
          item.noteIds = [...new Set([...(item.noteIds ?? []), ...noteIds])];
          item.updatedAt = now();
          return `Inbox item ${args.id} marked done${noteIds.length ? ` (linked to ${plural(noteIds.length, 'note')})` : ''}.`;
        }, `Claude: process inbox ${args.id}`),
      ),
  );

  server.registerTool(
    'delete_note',
    {
      title: 'Delete note',
      description:
        'Soft-delete a note and its flashcards (the deletion syncs to the app). Wikilinks to it will show as missing. ' +
        'Only use after merging any unique content into another note, e.g. for duplicates. Irreversible from here.',
      inputSchema: {
        id: z.string(),
      },
    },
    (args) =>
      run(() =>
        storage.mutate((v) => {
          const note = liveNote(v, args.id);
          const t = now();
          note.deleted = true;
          note.updatedAt = t;
          const cards = cardsOf(v, note.id);
          for (const c of cards) {
            c.deleted = true;
            c.updatedAt = t;
          }
          return `Deleted "${note.title}" (id ${note.id}) and ${plural(cards.length, 'flashcard')}.`;
        }, `Claude: delete note ${args.id}`),
      ),
  );
}

// ---------- local helpers ----------

/** Subtree ids for a topic given as path or id; fails if it does not exist. */
function topicSubtreeFor(v: Vault, ref: string): Set<ID> {
  const id = resolveTopicRef(v, ref, false);
  if (!id) fail(`Topic "${ref}" not found. Use list_topics to see valid paths and ids.`);
  return topicSubtree(v, id);
}

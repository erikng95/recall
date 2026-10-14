// End-to-end smoke test: spawns the MCP server over stdio against a temp vault file and exercises every tool and prompt.
// Run with:  node test/smoke.ts   (from the mcp/ directory)

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { emptyVault, newId, type Card, type ID, type InboxItem, type Note, type SrsState, type Topic, type Vault } from '../../shared/vault.ts';

const INDEX = fileURLToPath(new URL('../src/index.ts', import.meta.url));

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

interface ToolOut {
  isError: boolean;
  text: string;
}

/** Bullet lines ("- ...") under a "## Heading" line, up to the next "## " heading. */
function bulletsUnder(text: string, heading: string): string[] {
  const start = text.indexOf(heading);
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of text.slice(start + heading.length).split('\n')) {
    if (line.startsWith('## ')) break;
    if (line.startsWith('- ')) out.push(line);
  }
  return out;
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
    .join('\n');
}

async function connect(env: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'recall-smoke', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [INDEX],
    env,
  });
  await client.connect(transport);
  return client;
}

async function main(): Promise<void> {
  const file = join(tmpdir(), `recall-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const t0 = Date.now() - 60_000;

  // ---- seed: notes with tasks and an inbox item, which only the app can create normally ----
  const seed: Vault = emptyVault();
  const coldId = newId();
  const sleepId = newId();
  const inboxId = newId();
  seed.notes[coldId] = {
    id: coldId,
    title: 'Cold water immersion boosts metabolism',
    body: 'Cold exposure ==activates brown fat== in adults.\n\nSee also [[Missing thing]].',
    topicIds: [],
    tags: ['health'],
    createdAt: t0,
    updatedAt: t0,
    tasks: ['verify', 'cards'],
    taskNote: 'Check the 2019 study claim',
    source: { kind: 'podcast', title: 'Huberman Lab', locator: '12:30' },
  } satisfies Note;
  seed.notes[sleepId] = {
    id: sleepId,
    title: 'Sleep needs vary',
    body: 'Adults usually need 7-9 hours.',
    topicIds: [],
    tags: [],
    createdAt: t0,
    updatedAt: t0,
    tasks: ['organize', 'explain'],
    taskNote: 'Make it a good note',
  } satisfies Note;
  seed.inbox[inboxId] = {
    id: inboxId,
    text: 'The moon is about 384,400 km away on average.',
    status: 'new',
    createdAt: t0,
    updatedAt: t0,
    source: { kind: 'podcast', title: 'Test show' },
  } satisfies InboxItem;
  writeFileSync(file, JSON.stringify(seed, null, 2), 'utf8');

  const env: Record<string, string> = { ...(process.env as Record<string, string>), RECALL_LOCAL_FILE: file };
  delete env.RECALL_GITHUB_REPO;
  const client = await connect(env);

  async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolOut> {
    const r = await client.callTool({ name, arguments: args });
    return { isError: r.isError === true, text: textOf(r.content) };
  }
  function readFile(): Vault {
    return JSON.parse(readFileSync(file, 'utf8')) as Vault;
  }
  function idFromText(text: string): string {
    const m = text.match(/id ([0-9a-f-]{8,})/i);
    return m ? m[1] : '';
  }

  try {
    // ---- protocol surface ----
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name).sort();
    const expectedTools = [
      'vault_overview',
      'list_topics',
      'search_notes',
      'get_note',
      'list_inbox',
      'list_pending_tasks',
      'create_note',
      'update_note',
      'set_verification',
      'add_cards',
      'complete_task',
      'create_topic',
      'process_inbox_item',
      'delete_note',
      'knowledge_profile',
      'complete_topic_task',
    ].sort();
    check(
      'tools/list exposes all 16 tools',
      JSON.stringify(toolNames) === JSON.stringify(expectedTools),
      `got ${toolNames.join(', ')}`,
    );

    const prompts = await client.listPrompts();
    const promptNames = prompts.prompts.map((p) => p.name).sort();
    check(
      'prompts/list exposes the 6 prompts',
      JSON.stringify(promptNames) === JSON.stringify(['do_tasks', 'explore_topic', 'process_inbox', 'quiz_me', 'tidy_vault', 'verify_claims']),
      `got ${promptNames.join(', ')}`,
    );

    // ---- overview on the seeded vault ----
    let r = await call('vault_overview');
    check('vault_overview succeeds', !r.isError, r.text);
    check('overview counts 2 notes', r.text.includes('Notes: 2'), r.text);
    check('overview counts 1 new inbox item', r.text.includes('New inbox items: 1'), r.text);
    check('overview counts 2 pending-task notes', r.text.includes('Notes with pending Claude tasks: 2'), r.text);
    check('overview counts 2 never-checked notes', r.text.includes('Notes never fact-checked: 2'), r.text);

    // ---- pending tasks before work ----
    r = await call('list_pending_tasks');
    check('list_pending_tasks lists both flagged notes', r.text.includes('Cold water') && r.text.includes('Sleep needs vary'), r.text);
    check('list_pending_tasks explains task meanings', r.text.includes('verify — fact-check') && r.text.includes('explain — append'));
    check('list_pending_tasks includes full body', r.text.includes('==activates brown fat==') && r.text.includes('Adults usually need'));

    // ---- inbox ----
    r = await call('list_inbox');
    const inboxJson = JSON.parse(r.text) as { count: number; items: { id: string }[] };
    check('list_inbox returns the new item', inboxJson.count === 1 && inboxJson.items[0].id === inboxId, r.text);

    // ---- topics ----
    r = await call('create_topic', { path: 'Science/Biology/Genetics' });
    check('create_topic creates path', !r.isError && r.text.includes('Science/Biology/Genetics'), r.text);
    const geneticsId = idFromText(r.text);
    check('create_topic returns an id', geneticsId.length > 0, r.text);

    r = await call('create_topic', { path: 'science/BIOLOGY/genetics' });
    check('create_topic is idempotent and case-insensitive', idFromText(r.text) === geneticsId, r.text);

    r = await call('create_topic', { path: 'Science/Biology/Ecology', emoji: '🌿' });
    check('create_topic adds sibling topic with emoji', !r.isError && r.text.includes('Ecology'), r.text);

    r = await call('list_topics');
    check('list_topics shows Genetics with 0 notes', r.text.includes('Genetics (0 notes)'), r.text);

    // ---- create notes with a wikilink pair ----
    r = await call('create_note', {
      title: 'DNA stores genes',
      body: 'DNA is a molecule. ==Genes are encoded in DNA==. Related: [[Mendelian inheritance]].',
      topics: ['Science/Biology/Genetics'],
      tags: ['#genetics', 'biology'],
      source: { kind: 'article', title: 'Intro to genetics', url: 'https://example.org/genetics' },
    });
    check('create_note (DNA) succeeds', !r.isError, r.text);
    const dnaId = idFromText(r.text);

    r = await call('create_note', {
      title: 'Mendelian inheritance',
      body: 'Traits pass from parents to offspring. See [[DNA stores genes]].',
      topics: ['Science/Biology/Genetics'],
    });
    check('create_note (Mendel) succeeds', !r.isError, r.text);
    const mendelId = idFromText(r.text);

    r = await call('create_note', { title: 'dna stores genes', body: 'dup' });
    check('create_note rejects duplicate title', r.isError === true && r.text.includes(dnaId), r.text);

    r = await call('create_note', {
      title: 'Bad topic note',
      body: 'x',
      topics: ['Does/Not/Exist'],
    });
    check('create_note creates missing topic paths on the fly', !r.isError, r.text);

    // ---- search ----
    r = await call('search_notes', { query: 'mendel' });
    const sq = JSON.parse(r.text) as { results: { id: string }[] };
    check('search_notes by query finds Mendel note', sq.results.some((x) => x.id === mendelId), r.text);

    r = await call('search_notes', { topic: 'Science' });
    const st = JSON.parse(r.text) as { totalMatches: number; results: { id: string }[] };
    check(
      'search_notes topic includes descendants',
      st.totalMatches >= 2 && st.results.some((x) => x.id === dnaId) && st.results.some((x) => x.id === mendelId),
      r.text,
    );

    r = await call('search_notes', { tag: 'genetics' });
    check('search_notes by tag (case-insensitive, # stripped on create)', r.text.includes(dnaId), r.text);

    r = await call('search_notes', { topic: 'No such topic' });
    check('search_notes unknown topic is a tool error', r.isError === true, r.text);

    // ---- get_note & backlinks ----
    r = await call('get_note', { title: 'Mendelian inheritance' });
    check('get_note by title works', !r.isError && r.text.includes(`id: ${mendelId}`), r.text);
    check('get_note shows backlink from DNA note', r.text.includes('backlinks (1):') && r.text.includes('DNA stores genes'), r.text);

    r = await call('get_note', { id: dnaId });
    check('get_note resolves outgoing link to id', r.text.includes(`[[Mendelian inheritance]] → ${mendelId}`), r.text);
    check('get_note shows topics path', r.text.includes('Science/Biology/Genetics'), r.text);
    check('get_note shows source', r.text.includes('article "Intro to genetics"'), r.text);

    r = await call('get_note', { id: coldId });
    check('get_note marks missing links', r.text.includes('[[Missing thing]] → missing'), r.text);

    r = await call('get_note', {});
    check('get_note without id or title is a tool error', r.isError === true, r.text);

    // ---- update_note with title change rewrites links ----
    r = await call('update_note', { id: mendelId, title: "Mendel's laws of inheritance" });
    check('update_note title change succeeds', !r.isError && r.text.includes('rewrote') === false && r.text.includes('Rewrote links'), r.text);

    r = await call('get_note', { id: dnaId });
    check("other note's [[link]] was rewritten to new title", r.text.includes("[[Mendel's laws of inheritance]]"), r.text);
    const fileAfterRename = readFile();
    check(
      'rename rewrite is persisted to the file',
      fileAfterRename.notes[dnaId].body.includes("[[Mendel's laws of inheritance]]") &&
        !fileAfterRename.notes[dnaId].body.includes('[[Mendelian inheritance]]'),
    );

    r = await call('update_note', { id: dnaId, title: "Mendel's laws of inheritance" });
    check('update_note refuses a title already used by another note', r.isError === true, r.text);

    r = await call('update_note', { id: dnaId, appendBody: 'Extra fact. ==Mutations change genes==.' });
    check('update_note appendBody appends', !r.isError, r.text);
    check(
      'appendBody added after a blank line',
      readFile().notes[dnaId].body.includes('[[Mendel\'s laws of inheritance]].\n\nExtra fact.'),
      readFile().notes[dnaId].body,
    );

    // ---- verification ----
    r = await call('set_verification', {
      noteId: mendelId,
      verdict: 'supported',
      confidence: 0.9,
      summary: 'Mendel reported particulate inheritance in 1866; the patterns replicate in many organisms.',
      evidence: [
        { title: 'Mendel 1866 paper', url: 'https://example.org/mendel', stance: 'supports', quality: 'high' },
      ],
    });
    check('set_verification succeeds', !r.isError && r.text.includes('Supported'), r.text);
    const mendelRec = readFile().notes[mendelId];
    check(
      'set_verification stores claude checkedBy/checkedAt and evidence',
      mendelRec.verification?.checkedBy === 'claude' &&
        typeof mendelRec.verification?.checkedAt === 'number' &&
        mendelRec.verification?.evidence?.[0]?.url === 'https://example.org/mendel',
    );

    r = await call('set_verification', {
      noteId: coldId,
      verdict: 'mixed',
      confidence: 0.4,
      summary: 'Small studies only.',
      evidence: [],
    });
    check('set_verification clears "verify" task on seeded note', !r.isError, r.text);
    check(
      'seed note keeps "cards" task after verify is cleared',
      JSON.stringify(readFile().notes[coldId].tasks) === JSON.stringify(['cards']),
      JSON.stringify(readFile().notes[coldId].tasks),
    );

    r = await call('set_verification', { noteId: coldId, verdict: 'nonsense', confidence: 0.5, summary: 'x', evidence: [] });
    check('set_verification rejects an invalid verdict', r.isError === true, r.text);

    // ---- cards ----
    r = await call('add_cards', {
      noteId: dnaId,
      cards: [{ front: 'What encodes genes?', back: 'DNA' }],
    });
    check('add_cards succeeds', !r.isError, r.text);
    const cardsInFile = Object.values(readFile().cards).filter((c) => c.noteId === dnaId);
    check(
      'add_cards stores basic card with createdBy claude and no srs',
      cardsInFile.length === 1 && cardsInFile[0].kind === 'basic' && cardsInFile[0].createdBy === 'claude' && cardsInFile[0].srs === undefined,
      JSON.stringify(cardsInFile),
    );

    r = await call('add_cards', { noteId: coldId, cards: [{ front: 'Which fat does cold exposure activate?', back: 'Brown fat' }] });
    check('add_cards clears "cards" task', !r.isError && readFile().notes[coldId].tasks?.length === 0, r.text);
    check('clearing last task removes taskNote', readFile().notes[coldId].taskNote === undefined);

    r = await call('add_cards', { noteId: coldId, cards: [] });
    check('add_cards rejects an empty list', r.isError === true, r.text);

    // ---- complete_task ----
    r = await call('complete_task', { noteId: sleepId, task: 'organize' });
    check('complete_task removes one task', !r.isError && JSON.stringify(readFile().notes[sleepId].tasks) === '["explain"]', r.text);

    r = await call('complete_task', { noteId: sleepId, task: 'explain' });
    const sleepRec = readFile().notes[sleepId];
    check(
      'complete_task on last task clears taskNote',
      !r.isError && (sleepRec.tasks ?? []).length === 0 && sleepRec.taskNote === undefined,
      r.text,
    );

    r = await call('complete_task', { noteId: sleepId, task: 'cards' });
    check('complete_task on a non-pending task reports no change (not an error)', !r.isError && r.text.includes('was not pending'), r.text);

    r = await call('list_pending_tasks');
    check('no pending tasks remain', r.text.startsWith('No pending tasks'), r.text);

    // ---- inbox processing ----
    r = await call('process_inbox_item', { id: inboxId, noteIds: [dnaId] });
    check('process_inbox_item succeeds', !r.isError, r.text);
    r = await call('list_inbox');
    check('new inbox list is now empty', JSON.parse(r.text).count === 0, r.text);
    r = await call('list_inbox', { status: 'all' });
    const allItems = JSON.parse(r.text) as { items: { status: string; noteIds: string[] }[] };
    check(
      'inbox item is done and linked to the note',
      allItems.items[0]?.status === 'done' && allItems.items[0]?.noteIds.includes(dnaId),
      r.text,
    );
    r = await call('process_inbox_item', { id: 'does-not-exist' });
    check('process_inbox_item unknown id is a tool error', r.isError === true, r.text);

    // ---- topic tree / overview after work ----
    r = await call('list_topics', {});
    check('list_topics shows Ecology sibling', r.text.includes('Ecology'), r.text);

    // ---- delete ----
    r = await call('create_note', { title: 'Throwaway', body: 'to delete', topics: [] });
    const throwId = idFromText(r.text);
    r = await call('delete_note', { id: throwId });
    check('delete_note succeeds', !r.isError, r.text);
    check('delete_note writes tombstone (deleted: true)', readFile().notes[throwId]?.deleted === true);
    r = await call('search_notes', { query: 'Throwaway' });
    check('deleted note no longer appears in search', !r.text.includes(throwId), r.text);
    r = await call('delete_note', { id: throwId });
    check('deleting an already-deleted note is a tool error', r.isError === true, r.text);

    // ---- final overview ----
    r = await call('vault_overview');
    // Live notes: cold water, sleep, DNA, Mendel, "Bad topic note" (the throwaway was deleted).
    check('final overview: 5 live notes', r.text.includes('Notes: 5'), r.text);
    check('final overview: 0 pending tasks', r.text.includes('Notes with pending Claude tasks: 0'), r.text);
    // Sleep, DNA and Bad topic note have no verification; cold water and Mendel do.
    check('final overview: 3 never-checked notes', r.text.includes('Notes never fact-checked: 3'), r.text);
    check('final overview: 2 flashcards', r.text.includes('Flashcards: 2'), r.text);
    check('final overview: 0 inbox waiting', r.text.includes('New inbox items: 0'), r.text);

    // ---- phase 2: topic task + knowledge fixtures ----
    // Written into the same vault file after the core checks above, so the exact counts there stay meaningful.
    const day = 86_400_000;
    const nowMs = Date.now();
    const vf = readFile();
    const rootTopicId = newId();
    const stagesTopicId = newId();
    vf.topics[rootTopicId] = {
      id: rootTopicId,
      name: 'Sleep science',
      createdAt: t0,
      updatedAt: t0,
      tasks: ['explore'],
      level: 'beginner',
      taskNote: 'Focus on the mechanisms',
    } satisfies Topic;
    vf.topics[stagesTopicId] = {
      id: stagesTopicId,
      name: 'Stages',
      parentId: rootTopicId,
      createdAt: t0,
      updatedAt: t0,
    } satisfies Topic;

    const addNote = (title: string, body: string, topicId: ID): ID => {
      const id = newId();
      vf.notes[id] = { id, title, body, topicIds: [topicId], tags: [], createdAt: t0, updatedAt: t0 } satisfies Note;
      return id;
    };
    const stagesNoteId = addNote(
      'Sleep has distinct stages',
      'Sleep cycles through ==N1, N2, N3 and REM== stages. Background: [[Circadian rhythm]].',
      stagesTopicId,
    );
    const melatoninNoteId = addNote(
      'Melatonin is released in the evening',
      'Light suppresses ==melatonin== release.\n\nSee [[Circadian rhythm]].',
      rootTopicId,
    );
    const caffeineNoteId = addNote(
      'Caffeine half-life is about five hours',
      'Caffeine has a ==half-life of about five hours== in adults.',
      rootTopicId,
    );
    const napNoteId = addNote('Naps restore alertness', 'A ==20-minute nap== improves alertness.', rootTopicId);

    const addCard = (noteId: ID, front: string, back: string, srs: Partial<SrsState>): void => {
      const id = newId();
      const state: SrsState = {
        due: nowMs,
        stability: 1,
        difficulty: 5,
        elapsed_days: 0,
        scheduled_days: 1,
        learning_steps: 0,
        reps: 1,
        lapses: 0,
        state: 2,
        ...srs,
      };
      vf.cards[id] = { id, noteId, kind: 'basic', front, back, createdBy: 'me', createdAt: t0, updatedAt: t0, srs: state } satisfies Card;
    };
    // Well remembered: stability 30 days, reviewed yesterday.
    addCard(stagesNoteId, 'What are the stages of a sleep cycle?', 'N1, N2, N3 and REM', {
      stability: 30,
      last_review: nowMs - day,
      due: nowMs + 29 * day,
      elapsed_days: 1,
      scheduled_days: 30,
      reps: 6,
    });
    // Fading: reviewed 10 days ago with stability 2 days.
    addCard(melatoninNoteId, 'What does evening light do to melatonin release?', 'It suppresses it', {
      stability: 2,
      last_review: nowMs - 10 * day,
      due: nowMs - 8 * day,
      elapsed_days: 10,
      scheduled_days: 2,
      reps: 3,
      lapses: 1,
    });
    // Leech: forgotten five times.
    addCard(caffeineNoteId, 'How long is the half-life of caffeine?', 'About five hours', {
      stability: 1,
      last_review: nowMs - 3 * day,
      due: nowMs - 2 * day,
      elapsed_days: 3,
      scheduled_days: 1,
      reps: 9,
      lapses: 7,
    });
    writeFileSync(file, JSON.stringify(vf, null, 2), 'utf8');

    r = await call('vault_overview');
    check('overview counts the topic with a pending task', r.text.includes('Topics with pending tasks: 1'), r.text);
    check('overview shows overall mastery and its label', /Overall mastery: \d+% \((Not started|Learning|Getting there|Solid|Mastered)\)/.test(r.text), r.text);
    check('overview counts 9 notes and 5 flashcards after the fixtures', r.text.includes('Notes: 9') && r.text.includes('Flashcards: 5'), r.text);

    r = await call('list_pending_tasks');
    check('list_pending_tasks shows the topic with its explore task', r.text.includes('## Sleep science') && r.text.includes(`id: ${rootTopicId}`) && r.text.includes('tasks: explore'), r.text);
    check('list_pending_tasks explains the explore task', r.text.includes('explore — Write a starter pack') && r.text.includes('complete_topic_task'), r.text);
    check('topic entry has level and task note', r.text.includes('level: beginner') && r.text.includes('Focus on the mechanisms'), r.text);
    check('topic entry lists notes already in its subtree', r.text.includes('"Sleep has distinct stages"') && r.text.includes('"Naps restore alertness"'), r.text);
    check('topic entry has a one-line knowledge summary', /knowledge: mastery \d+% \(/.test(r.text), r.text);

    r = await call('complete_topic_task', { topicId: rootTopicId, task: 'explore' });
    check('complete_topic_task clears the explore task', !r.isError && r.text.includes('Cleared'), r.text);
    const doneTopic = readFile().topics[rootTopicId];
    check(
      'complete_topic_task persists: no tasks left and taskNote removed',
      (doneTopic.tasks ?? []).length === 0 && doneTopic.taskNote === undefined,
      JSON.stringify(doneTopic),
    );
    check('complete_topic_task bumps updatedAt', doneTopic.updatedAt > t0);

    r = await call('list_pending_tasks');
    check('list_pending_tasks no longer lists the topic', r.text.startsWith('No pending tasks'), r.text);

    r = await call('complete_topic_task', { topicId: rootTopicId, task: 'explore' });
    check('completing a topic task that is not pending is not an error', !r.isError && r.text.includes('was not pending'), r.text);

    r = await call('complete_topic_task', { topicId: 'no-such-topic', task: 'explore' });
    check('complete_topic_task unknown topic is a tool error', r.isError === true, r.text);

    r = await call('vault_overview');
    check('overview: 0 topics with pending tasks after completion', r.text.includes('Topics with pending tasks: 0'), r.text);

    r = await call('knowledge_profile');
    check('knowledge_profile succeeds for the whole vault', !r.isError && r.text.startsWith('Knowledge profile: whole vault'), r.text);
    check('knowledge_profile reports mastery and leeches', /Mastery: \d+% \(/.test(r.text) && r.text.includes('Leeches: 1'), r.text);
    check(
      'knowledge_profile lists the leech card with its note',
      r.text.includes('"How long is the half-life of caffeine?" — note "Caffeine half-life is about five hours", 7 lapses'),
      r.text,
    );
    check('knowledge_profile lists missing notes with reference count', r.text.includes('[[Circadian rhythm]] — linked from 2 notes') && r.text.includes('[[Missing thing]]'), r.text);
    check('knowledge_profile lists notes without flashcards', bulletsUnder(r.text, '## Notes without flashcards').some((l) => l.includes('Naps restore alertness')), r.text);
    check('knowledge_profile topic table includes subtopics', r.text.includes('| Sleep science/Stages |'), r.text);

    r = await call('knowledge_profile', { topic: 'Sleep science', limit: 3 });
    check('knowledge_profile scoped by topic path', !r.isError && r.text.startsWith('Knowledge profile: Sleep science'), r.text);
    check('scoped profile leaves out notes outside the topic', !r.text.includes('Missing thing') && !r.text.includes('DNA stores genes'), r.text);
    const weakest = bulletsUnder(r.text, '## Weakest notes');
    check(
      'weakest notes: the well-remembered note comes last',
      weakest.length === 3 && weakest[2].includes('Sleep has distinct stages'),
      weakest.join('\n'),
    );
    check('scoped profile has the topic row with its subtopic row', r.text.includes('| Sleep science |') && r.text.includes('| Sleep science/Stages |'), r.text);

    r = await call('knowledge_profile', { topic: 'Nope/Nothing' });
    check('knowledge_profile unknown topic is a tool error', r.isError === true, r.text);

    // ---- prompts ----
    const pi = await client.getPrompt({ name: 'process_inbox' });
    check('process_inbox prompt renders', textOf(pi.messages.map((m) => m.content)).includes('list_inbox'));

    const vcPlain = await client.getPrompt({ name: 'verify_claims', arguments: {} });
    const vcPlainText = textOf(vcPlain.messages.map((m) => m.content));
    check('verify_claims without arg only targets verify tasks', !vcPlainText.includes('verdict "unchecked"'));

    const vcAll = await client.getPrompt({ name: 'verify_claims', arguments: { all: 'all' } });
    const vcAllText = textOf(vcAll.messages.map((m) => m.content));
    check('verify_claims with "all" also targets unchecked notes', vcAllText.includes('verdict "unchecked"'));

    const dt = await client.getPrompt({ name: 'do_tasks' });
    check('do_tasks prompt renders', textOf(dt.messages.map((m) => m.content)).includes('list_pending_tasks'));
    check('do_tasks also covers explore topic tasks', textOf(dt.messages.map((m) => m.content)).includes('complete_topic_task'));

    const tv = await client.getPrompt({ name: 'tidy_vault' });
    check('tidy_vault prompt renders', textOf(tv.messages.map((m) => m.content)).includes('Broken links'));

    const epAll = await client.getPrompt({ name: 'explore_topic', arguments: {} });
    const epAllText = textOf(epAll.messages.map((m) => m.content));
    check(
      'explore_topic without args handles every topic with an explore task',
      epAllText.includes('every topic with an "explore" task') && epAllText.includes('complete_topic_task') && epAllText.includes('knowledge_profile'),
      epAllText,
    );

    const epTopic = await client.getPrompt({ name: 'explore_topic', arguments: { topic: 'Sleep science' } });
    const epTopicText = textOf(epTopic.messages.map((m) => m.content));
    check(
      'explore_topic with a topic targets it and creates it if missing',
      epTopicText.includes('the topic "Sleep science"') && epTopicText.includes('create_topic') && epTopicText.includes('set_verification'),
      epTopicText,
    );

    const qzAll = await client.getPrompt({ name: 'quiz_me', arguments: {} });
    const qzAllText = textOf(qzAll.messages.map((m) => m.content));
    check(
      'quiz_me without args quizzes the whole vault, one question at a time',
      qzAllText.includes('the whole vault') && qzAllText.includes('ONE question at a time') && qzAllText.includes('knowledge_profile.'),
      qzAllText,
    );

    const qzTopic = await client.getPrompt({ name: 'quiz_me', arguments: { topic: 'Sleep science' } });
    const qzTopicText = textOf(qzTopic.messages.map((m) => m.content));
    check(
      'quiz_me with a topic scopes knowledge_profile to it and stays grounded',
      qzTopicText.includes('the topic "Sleep science"') && qzTopicText.includes('knowledge_profile with topic "Sleep science"') && qzTopicText.includes('Never present an invented fact'),
      qzTopicText,
    );
  } finally {
    await client.close();
  }

  // ---- config error path: no storage configured must not crash, must explain ----
  const bareEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete bareEnv.RECALL_LOCAL_FILE;
  delete bareEnv.RECALL_GITHUB_REPO;
  const bare = await connect(bareEnv);
  try {
    const r = await bare.callTool({ name: 'vault_overview', arguments: {} });
    const text = textOf(r.content);
    check(
      'unconfigured server returns an explanatory tool error',
      r.isError === true && text.includes('RECALL_GITHUB_REPO') && text.includes('RECALL_LOCAL_FILE'),
      text,
    );
  } finally {
    await bare.close();
  }

  rmSync(file, { force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error('FAIL smoke test crashed:', err);
  process.exitCode = 1;
});

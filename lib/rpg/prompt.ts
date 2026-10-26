import { calculateAge, formatDate } from './calendar';
import { groupJutsuByNature } from './jutsu';
import { estimateTokens } from '../openrouter';
import { relevantFacts, retrieveMemories, triggeredLore } from './retrieval';
import type {
  AppDatabase,
  BondRecord,
  EventRecord,
  FactRecord,
  OpenRouterMessage,
  RawLogEntry,
  ThreadRecord,
} from './types';

export const NARRATION_SYSTEM = `You are the narrator and game master of an interactive novel set in the Naruto world. The player plays Kan. You control the world and every other character.

CRITICAL EXECUTIVE DIRECTIVE (NEVER VIOLATE):
You control the environment, the passage of time, and all NPCs. You DO NOT control Kan. You must NEVER speak, act, think, emote, or decide for Kan. Stop your response the moment Kan needs to react, speak, or take action.

PLAYER RULES
- The player controls Kan's actions, words, and decisions. Never speak, act, or decide for Kan beyond what the player wrote. Describe the world and other characters' reactions, then stop and let the player act.
- Kan's default nature (quiet, timid, stoic) colors how scenes feel, but never overrides the player's choices.

CANON CHARACTERS
- Every character from the Naruto universe is available and must be written faithfully to canon: personality, values, mood, speech patterns, mannerisms, abilities, appearance, and relationships.
- Respect the in-story date. Characters are the age they would be at that date, hold the rank and position they would hold, and know only what they could know at that point. No character may reference events that have not happened yet in this story.
- Canon strength is real. Powerful characters stay powerful, weak characters stay limited. No power creep, no convenient nerfing.
- Characters have their own goals and do not exist to serve Kan. They can refuse, lie, disagree, or leave.
- NPCs will not instantly love, trust, or agree with Kan. Relationships must be earned through consistent, logical interactions.

CANON VS. THIS STORY
- Canon events happen on their canon timeline unless Kan's actions plausibly change them. If the player changes something, follow the consequences realistically and record it as a new fact.
- If the provided context contradicts canon (facts ledger, lore entries), the provided context wins.

NEW CHARACTERS
- Create original characters whenever the world needs them: villagers, shinobi, merchants, rivals, clients, enemies.
- Make each distinct: name, age, role, personality, speech style, look, goals.
- New characters must fit the setting, the date, and canon power levels. No world-shaking original character unless the story has built toward it.

RANDOM ENCOUNTERS
- Use the d20 encounter hint to choose event scale; do not mention the roll.
- Encounters are rare. Most turns are quiet. When the hint says nothing special happens, introduce no new characters and no interruptions.
- Never stack encounters: at most one new character or event per turn, and never two encounters in a row.
- Quiet in the middle of an emotional scene. Encounters should have consequences and can be ignored by the player without breaking the story.

CONTINUITY & PACING
- Never repeat an NPC gesture, action, or line you already used in the recent scene (same adjustment, same stance, same phrase). Each beat must move the story forward.
- Open threads are binding missions. Never change a destination, objective, or ally mid-mission unless Kan decides to. Follow the stated goal until the player changes it.
- Compress routine travel: cross days of uneventful travel in one or two paragraphs. Never pad travel with filler encounters or repeated camps.

LITERARY NARRATION & REALISM
- Write in immersive, gritty second-person perspective. Kan is "you." Show, don't tell: the guttering candlelight, the smell of damp rot, the heavy silence.
- Ground the narrative in physical reality: gravity, fatigue, injury, terrain, weather, and layout.
- Every action has an equal reaction. Reckless choices get punished; clever choices get rewarded.
- Kan's mood and NPC moods should be visible in behavior, posture, tone, and small choices.
- Quiet moments are allowed. Not every turn needs a major event.

PACING & TURN-BASED PAUSING
- Limit responses to 2 to 4 paragraphs. Do not fast-forward through conversations, combat, or travel unless Kan explicitly requests a time skip.
- Always end your turn on a sensory hook, an unanswered question, NPC dialogue, or a looming threat that forces Kan to respond.

CANON AND TIME
- Respect the canon timeline and track where major characters should be.
- If Kan causes divergence, show the consequences and explain them naturally in the story.
- Use the in-story calendar. Advance time only when the action clearly requires it.
- Years may pass. When they do, briefly show what happened meanwhile.

FORMATTING CONSTRAINTS
- No meta-text: never write introductory filler, end-of-turn summaries, or out-of-character commentary.
- Kan's input uses manual markers for speech and action:
  - Text inside straight quotation marks is speech Kan says aloud.
  - Text wrapped in asterisks is an action, gesture, or physical movement Kan performs.
  - A single player message may mix speech and action in one line.
- Use clean quotation marks for NPC speech.
- Use italics only for internal NPC thoughts if necessary.
- Start directly with the narrative.

MEMORY & CONTINUITY
- You will be given Kan's state, character cards, jutsu, bonds, facts ledger, open threads, summaries, and relevant past events. Treat them as truth. Never contradict them.
- Honor bonds: how a character treats Kan depends on their affinity and history with him.
- Respect who-knows-what. Characters only know secrets they have learned in the story.

STATE OUTPUT (MANDATORY)
- After your narration, on the last lines, output exactly one fenced JSON block with changes only.
- Schema:
\`\`\`json
{
  "state": { "location": string, "canon_point": string, "inventory_and_jutsu_changes": string[] },
  "time": { "days_passed": number, "time_of_day": "morning" | "afternoon" | "evening" | "night" },
  "mood": string,
  "world_description": string,
  "jutsu_used": [{ "name": string, "user": string, "chakra_nature": string, "effect": string, "visual": string }],
  "bonds": [{ "character": string, "affinity_change": number (-10..10 per turn, cumulative), "status": string, "note": string }],
  "facts": [{ "entity": string, "fact": string }],
  "threads": [{ "description": string, "status": "open" | "resolved" }],
  "new_characters": [{ "name": string, "age": number, "role": string, "personality": string, "speech_style": string, "appearance_block": string }],
  "characters_present": string[],
  "scene_ended": boolean,
  "image_worthy": boolean
}
\`\`\`
- Record only changes. If nothing changed, output \`\`\`json {} \`\`\` with no keys.
- time: days_passed is 0 if the scene continues immediately, 1 for a normal scene break, more for travel, training, or skips the player requested. When Kan sleeps through the night or a night passes, days_passed is 1 and time_of_day is "morning". time_of_day is when the NEXT beat happens.
- state.location: set it whenever Kan moves to a new area, building, or settlement.
- characters_present: names of every NPC present or in direct contact with Kan in this beat (speech, fight, or face-to-face). Omit when Kan is alone.
- mood: Kan's current mood in 1-3 words, only when it changed.
- world_description: one sentence about the wider world, only when it changed.
- scene_ended: true only when the scene clearly concluded (arrival, rest, major beat). Most turns are false.
- jutsu_used: only when a named jutsu is performed. user is the performer's name (Kan or an NPC). chakra_nature must be one of: Fire, Water, Wind, Earth, Lightning, Wood, Ice, Lava, Boil, Storm, Yin, Yang, Yin-Yang, Physical, Genjutsu, Space-Time, Unknown.
- Never contradict the facts ledger or the bonds you are given.
- Only include bonds for important characters; minor ones go in facts as one-line notes.
- image_worthy is true only for visually striking moments (conflict, reunion, dramatic weather, strong emotion). It is false for pure dialogue or quiet turns.`;

const EXTRACTION_SYSTEM = `You are a strict JSON state extractor for an interactive RPG.

Return only one JSON object and nothing else. No markdown, no code fences, no commentary.

Allowed top-level fields:
{
  "state": {
    "mood": string,
    "worldDescription": string,
    "jutsuAdded": string[],
    "jutsuRemoved": string[],
    "inventoryAdded": string[],
    "inventoryRemoved": string[],
    "location": string,
    "inStoryDate": { "year": number, "month": number, "day": number, "timeOfDay": "morning" | "afternoon" | "evening" | "night" },
    "canonPoint": string,
    "chapter": number,
    "scene": string
  },
  "entities": [
    { "name": string, "age": number, "role": string, "personality": string, "speechStyle": string, "mood": string, "appearance": string }
  ],
  "jutsuUsed": [
    { "name": string, "user": string, "chakraNature": string, "effect": string, "visual": string, "description": string }
  ],
  "bonds": [
    { "character": string, "affinityDelta": number, "status": string, "note": string, "isMajor": boolean }
  ],
  "facts": [
    { "action": "add" | "end", "type": "death" | "injury" | "secret" | "knowledge" | "membership" | "possession" | "event" | "other", "text": string, "subject": string, "whoKnows": string[], "validFrom": { "year": number, "month": number, "day": number, "timeOfDay": "morning" | "afternoon" | "evening" | "night" } }
  ],
  "threads": [
    { "action": "open" | "update" | "resolve", "title": string, "description": string, "type": "promise" | "debt" | "grudge" | "mystery" | "quest" | "goal" | "other", "participants": string[] }
  ],
  "scene": { "ended": boolean, "summary": string, "tags": string[], "entities": string[], "importance": 1 | 2 | 3 | 4 | 5 }
}

Rules:
- Return only changes. If nothing changed, return {}.
- Never contradict the provided state, bonds, facts, or threads.
- Only add facts that are permanent or long-term.
- Only add bonds for important characters.
- Use short, concrete notes.
- Update Kan's mood when the story clearly changes it.
- Update NPC moods when their behavior or circumstances change.
- Only update appearance when the story clearly changes it.
- Give every new recurring original character an entities entry with age, role, personality, speechStyle, mood, and appearance.
- Record any jutsu used by Kan or an NPC in jutsuUsed.
- For each jutsu, include chakraNature, effect, and visual. Keep them short, concrete, and consistent with earlier uses.
- chakraNature must use one canonical category: Fire, Water, Wind, Earth, Lightning, Wood, Ice, Lava, Boil, Storm, Yin, Yang, Yin-Yang, Physical, Genjutsu, Space-Time, or Unknown.
- If a technique blends natures, choose its primary nature and describe the blend in effect or visual.
- Keep worldDescription to one or two concise sentences about the current state of the world.
- If a scene clearly ended, set scene.ended to true and provide a one-sentence scene.summary.`;

const SUMMARY_SYSTEM = `You are a story summarizer for a long-running interactive novel.

Write a 100-150 word summary of the supplied scene.
- Third person, present tense.
- Concrete and specific.
- No meta-text, no commentary, no greeting.
- Mention Kan by name and the most important NPCs, choices, and consequences.
- Preserve any timeline information.`;

const ARC_SUMMARY_SYSTEM = `You are a story archivist for a long-running interactive novel.

Combine the supplied chapter summaries into one compact arc summary.
- 120-180 words.
- Third person, present tense.
- Keep cause and effect clear.
- Preserve names, dates, and major consequences.
- No meta-text.`;

const TIME_SKIP_SYSTEM = `You are a time-skip narrator for a long-running interactive novel.

Write 100-150 words describing what happened meanwhile during the supplied time skip.
- Third person, present tense.
- Focus on Kan's off-screen growth, NPC changes, and world movement.
- Respect the facts and bonds provided.
- No meta-text.`;

export function buildNarrationPrompt(
  db: AppDatabase,
  userMessage: string,
  d20: number
) {
  const withCurrent = getRecentMessages(db, db.settings.contextMessages + 1);
  const currentIsLast =
    withCurrent.length > 0 &&
    withCurrent[withCurrent.length - 1].role === 'user' &&
    withCurrent[withCurrent.length - 1].content === userMessage;

  const recentMessages = currentIsLast
    ? withCurrent.slice(0, -1).slice(-db.settings.contextMessages)
    : withCurrent.slice(-db.settings.contextMessages);

  const memories = retrieveMemories(
    db,
    { recentMessages: withCurrent, userMessage },
    db.settings.retrievalLimit
  );
  const entityText = [...recentMessages.map((message) => message.content), userMessage].join('\n');
  const matchedEntityIds = new Set(
    db.entities
      .filter((entity) =>
        [entity.name, ...entity.aliases].some((name) =>
          entityText.toLowerCase().includes(name.toLowerCase())
        )
      )
      .map((entity) => entity.id)
  );
  const facts = relevantFacts(db, matchedEntityIds, entityText);
  const lore = triggeredLore(db, entityText);
  const arcSummary = getArcSummary(db);

  const stable = [
    NARRATION_SYSTEM,
    formatCharacterSheet(db),
    formatState(db),
    formatMatchedEntities(db, matchedEntityIds),
    formatJutsu(db),
    formatBonds(db),
    formatFacts(facts),
    formatThreads(db),
    formatLore(lore),
  ].join('\n\n');

  const dynamic = [
    formatArcSummary(arcSummary),
    formatMemories(memories),
    formatRecentMessages(recentMessages),
    formatEncounterHint(d20),
    `YOU (KAN) DO OR SAY:\n${userMessage}`,
  ].join('\n\n');

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: stable },
    { role: 'user', content: dynamic },
  ];

  return {
    messages,
    estimatedTokens: estimateTokens(messages),
    memories,
    recentMessages,
    arcSummary,
  };
}

export function buildExtractionPrompt(
  db: AppDatabase,
  userMessage: string,
  assistantMessage: string
) {
  const recentMessages = getRecentMessages(db, 4);
  const stable = [
    EXTRACTION_SYSTEM,
    formatState(db),
    formatEntities(db),
    formatJutsu(db),
    formatBonds(db),
    formatFacts(db.facts.filter((fact) => fact.validTo === null).slice(0, 10)),
    formatThreads(db),
  ].join('\n\n');

  const dynamic = [
    'LAST TURN',
    `You (Kan): ${userMessage}`,
    `Narrator: ${assistantMessage}`,
    'Return the JSON diff now.',
  ].join('\n\n');

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: stable },
    { role: 'user', content: dynamic },
  ];

  return {
    messages,
    estimatedTokens: estimateTokens(messages),
    recentMessages,
  };
}

export function buildSceneSummaryPrompt(
  db: AppDatabase,
  messages: RawLogEntry[]
) {
  const transcript = messages
    .map(
      (message) =>
        `${message.role === 'user' ? 'You (Kan)' : 'Narrator'}: ${truncate(message.content, 1000)}`
    )
    .join('\n\n');

  const system = [
    SUMMARY_SYSTEM,
    formatState(db),
    formatBonds(db),
  ].join('\n\n');

  const user = `SCENE TRANSCRIPT:\n${transcript}\n\nWrite the summary now.`;
  const promptMessages: OpenRouterMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  return {
    messages: promptMessages,
    estimatedTokens: estimateTokens(promptMessages),
  };
}

export function buildArcSummaryPrompt(
  db: AppDatabase,
  summaries: string[]
) {
  const system = [
    ARC_SUMMARY_SYSTEM,
    formatState(db),
  ].join('\n\n');

  const user = `CHAPTER SUMMARIES:\n${summaries.map((summary, index) => `${index + 1}. ${summary}`).join('\n')}\n\nWrite the arc summary now.`;
  const promptMessages: OpenRouterMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  return {
    messages: promptMessages,
    estimatedTokens: estimateTokens(promptMessages),
  };
}

export function buildTimeSkipPrompt(
  db: AppDatabase,
  from: string,
  to: string
) {
  const system = [
    TIME_SKIP_SYSTEM,
    formatState(db),
    formatBonds(db),
    formatFacts(db.facts.filter((fact) => fact.validTo === null).slice(0, 10)),
  ].join('\n\n');

  const user = `TIME SKIP:\nFrom ${from}\nTo ${to}\n\nWrite the "meanwhile" summary now.`;
  const promptMessages: OpenRouterMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  return {
    messages: promptMessages,
    estimatedTokens: estimateTokens(promptMessages),
  };
}

export function getRecentMessages(db: AppDatabase, limit: number): RawLogEntry[] {
  return db.rawLog
    .filter((message) => message.kind === 'story')
    .slice(-limit);
}

function getArcSummary(db: AppDatabase): string | null {
  const arc = [...db.summaries]
    .filter((summary) => summary.level === 'arc')
    .sort((a, b) => b.createdAt - a.createdAt)[0];

  if (arc) {
    return arc.text;
  }

  const chapter = [...db.summaries]
    .filter((summary) => summary.level === 'chapter')
    .sort((a, b) => b.createdAt - a.createdAt)[0];

  return chapter?.text ?? null;
}

function formatCharacterSheet(db: AppDatabase) {
  const player = db.state.player;

  return [
    'PLAYER CHARACTER',
    `Name: ${player.name}`,
    `Lineage: ${player.lineage.join(', ')}`,
    `Birthday: month ${player.birthday.month}, day ${player.birthday.day}`,
    `Birth year: ${player.birthYear}`,
    `Age: ${calculateAge(db.state.inStoryDate, player.birthday, player.birthYear)}`,
    `Rank/Role: ${player.rank} / ${player.role}`,
    `Team: ${player.team.join(', ')}`,
    `Sensei: ${player.sensei}`,
    `Personality: ${player.personality.join(', ')}`,
    player.secretNotes.length > 0
      ? `Secret notes: ${player.secretNotes.join(' | ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatState(db: AppDatabase) {
  const state = db.state;

  return [
    'CURRENT STATE',
    `Date: ${formatDate(state.inStoryDate)}`,
    `Location: ${truncate(state.location, 100)}`,
    `Kan's mood: ${truncate(state.mood, 60)}`,
    `World: ${truncate(state.worldDescription, 220)}`,
    `Jutsu: ${truncate(state.jutsu.slice(-10).join(', '), 240) || 'none'}`,
    `Inventory: ${truncate(state.inventory.slice(-10).join(', '), 240) || 'none'}`,
    `Canon point: ${truncate(state.canonPoint, 220)}`,
    `Chapter: ${state.chapter}`,
    `Scene: ${truncate(state.scene, 140)}`,
  ].join('\n');
}

function formatMatchedEntities(db: AppDatabase, entityIds: Set<string>) {
  if (entityIds.size === 0) {
    return '';
  }

  const characters = db.entities
    .filter(
      (entity) =>
        entity.type === 'character' &&
        entityIds.has(entity.id) &&
        entity.name.toLowerCase() !== 'kan'
    )
    .slice(0, 6);

  if (characters.length === 0) {
    return '';
  }

  return [
    'CHARACTERS IN SCENE',
    ...characters.map(
      (entity) =>
        `- ${entity.name}${entity.aliases.length > 0 ? ` (also called ${entity.aliases[0]})` : ''}${entity.role ? ` (${truncate(entity.role, 40)})` : ''}: personality ${truncate(entity.personality ?? 'unknown', 60)}; speech ${truncate(entity.speechStyle ?? 'unknown', 50)}; mood ${truncate(entity.mood ?? 'unknown', 60)}; appearance ${truncate(entity.appearance ?? 'unknown', 80)}`
    ),
  ].join('\n');
}

function formatEntities(db: AppDatabase) {
  const characters = db.entities
    .filter((entity) => entity.type === 'character')
    .sort((a, b) => {
      const aKan = a.name.toLowerCase() === 'kan' ? 1 : 0;
      const bKan = b.name.toLowerCase() === 'kan' ? 1 : 0;

      if (aKan !== bKan) {
        return bKan - aKan;
      }

      return b.id.localeCompare(a.id);
    })
    .slice(0, 12);

  if (characters.length === 0) {
    return 'CHARACTERS\nNone.';
  }

  return [
    'CHARACTERS',
    ...characters.map(
      (entity) => {
        const age =
          entity.birthYear !== undefined && entity.birthday
            ? calculateAge(
                db.state.inStoryDate,
                entity.birthday,
                entity.birthYear
              )
            : entity.age;

        const mood = truncate(entity.mood ?? 'unknown', 60);
        const appearance = truncate(entity.appearance ?? 'unknown', 80);
        const personality = truncate(entity.personality ?? 'unknown', 60);
        const speech = truncate(entity.speechStyle ?? 'unknown', 50);
        const role = truncate(entity.role ?? '', 40);

        const aliasNote = entity.aliases.length > 0 ? ` (also called ${entity.aliases[0]})` : '';

        return `- ${entity.name}${aliasNote}${age !== undefined ? `, age ${age}` : ''}${role ? `, ${role}` : ''}: personality ${personality}; speech ${speech}; mood ${mood}; appearance ${appearance}`;
      }
    ),
  ].join('\n');
}

function formatJutsu(db: AppDatabase) {
  const groups = groupJutsuByNature(db.jutsuRecords).slice(0, 5);

  if (groups.length === 0) {
    return 'KNOWN JUTSU\nNone.';
  }

  return [
    'KNOWN JUTSU',
    ...groups.map((group) => {
      const lines = group.jutsu
        .slice(0, 3)
        .map(
          (record) =>
            `  - ${record.name} (${record.user}): effect ${truncate(record.effect, 60)}; visual ${truncate(record.visual, 60)}`
        );

      return `${group.nature}\n${lines.join('\n')}`;
    }),
  ].join('\n');
}

function formatBonds(db: AppDatabase) {
  const bonds = [...db.bonds]
    .filter((bond) => bond.isMajor || Math.abs(bond.affinity) >= 4)
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, 10);

  if (bonds.length === 0) {
    return 'BONDS\nNone yet.';
  }

  return [
    'BONDS',
    ...bonds.map(
      (bond) =>
        `- ${bond.characterName} (${bond.affinity}/10): ${truncate(bond.status ?? 'unknown', 50)}. ${truncate(bond.note, 80)}`
    ),
  ].join('\n');
}

function formatFacts(facts: FactRecord[]) {
  if (facts.length === 0) {
    return 'PERMANENT FACTS\nNone.';
  }

  return [
    'PERMANENT FACTS',
    ...facts.map(
      (fact) =>
        `- ${truncate(fact.text, 100)}${fact.whoKnows.length > 0 ? ` (known by: ${truncate(fact.whoKnows.join(', '), 40)})` : ''}`
    ),
  ].join('\n');
}

function formatThreads(db: AppDatabase) {
  const threads = db.threads
    .filter((thread) => thread.status === 'open')
    .sort((a, b) => {
      const aTime = a.openedAt ? dateKey(a.openedAt) : 0;
      const bTime = b.openedAt ? dateKey(b.openedAt) : 0;

      return bTime - aTime;
    })
    .slice(0, 8);

  if (threads.length === 0) {
    return 'OPEN THREADS\nNone.';
  }

  return [
    'OPEN THREADS',
    ...threads.map((thread) => `- ${truncate(thread.title, 60)}: ${truncate(thread.description, 80)}`),
  ].join('\n');
}

function dateKey(date: { year: number; month: number; day: number }) {
  return date.year * 10000 + date.month * 100 + date.day;
}

function formatLore(lore: AppDatabase['loreEntries']) {
  if (lore.length === 0) {
    return '';
  }

  return [
    'RELEVANT LORE',
    ...lore.map((entry) => `- ${truncate(entry.text, 150)}`),
  ].join('\n');
}


function truncate(value: string, maxLength: number) {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}…`;
}

function formatArcSummary(summary: string | null) {
  return `CURRENT ARC SUMMARY\n${truncate(summary ?? 'No arc summary yet.', 400)}`;
}

function formatMemories(memories: EventRecord[]) {
  if (memories.length === 0) {
    return 'RELEVANT MEMORIES\nNone.';
  }

  return [
    'RELEVANT MEMORIES',
    ...memories.map((memory) => `- ${truncate(memory.summary, 120)}`),
  ].join('\n');
}

function formatRecentMessages(messages: RawLogEntry[]) {
  if (messages.length === 0) {
    return 'RECENT SCENE\nThe story is just beginning.';
  }

  return [
    'RECENT SCENE',
    ...messages.map(
      (message) =>
        `${message.role === 'user' ? 'You (Kan)' : 'Narrator'}: ${
          message.role === 'assistant'
            ? truncate(stripNarrationJson(message.content), 1400)
            : truncate(message.content, 600)
        }`
    ),
  ].join('\n');
}

export function formatEncounterHint(d20: number) {
  let hint = 'nothing special happens; keep the turn quiet';

  if (d20 >= 20) {
    hint = 'a major canon event or crisis occurs';
  } else if (d20 >= 17) {
    hint = 'a named canon character appears, if plausible for the timeline';
  } else if (d20 >= 13) {
    hint = 'a minor NPC or small event appears';
  }

  return `ENCOUNTER HINT (d20 ${d20}): ${hint}`;
}

export function stripNarrationJson(raw: string): string {
  const { narration } = splitNarrationAndDiff(raw);
  return narration;
}

const DIFF_KEY_PATTERN = /"(?:state|bonds|facts|threads|new_characters|image_worthy)"\s*:/;
const DIFF_OBJECT_START = /\{\s*"(?:state|bonds|facts|threads|new_characters|image_worthy)"/g;
const FENCE_OPEN = /```(?:json)?/g;
const TRAILING_LABEL =
  /^\s*\**\s*(?:state|json)\b[\w\s]{0,40}:\s*\**\s*$/i;

function isDiffLike(content: string, parsed: Record<string, unknown> | null): boolean {
  if (parsed && looksLikeStateDiff(parsed)) {
    return true;
  }

  return DIFF_KEY_PATTERN.test(content);
}

function cleanNarration(narration: string): string {
  let cleaned = narration.replace(FENCE_OPEN, '');

  for (;;) {
    const trimmedEnd = cleaned.replace(/[\s]+$/, '');
    const lastLineStart = trimmedEnd.lastIndexOf('\n');
    const lastLine = lastLineStart === -1 ? trimmedEnd : trimmedEnd.slice(lastLineStart + 1);

    if (lastLine.trim() && TRAILING_LABEL.test(lastLine)) {
      cleaned = trimmedEnd.slice(0, lastLineStart === -1 ? trimmedEnd.length : lastLineStart);
      continue;
    }

    cleaned = trimmedEnd;
    break;
  }

  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

export function splitNarrationAndDiff(raw: string): {
  narration: string;
  inlineDiff: Record<string, unknown> | null;
} {
  let junkStart = -1;
  let inlineDiff: Record<string, unknown> | null = null;

  FENCE_OPEN.lastIndex = 0;
  let fenceMatch: RegExpExecArray | null;

  while ((fenceMatch = FENCE_OPEN.exec(raw)) !== null) {
    const contentStart = fenceMatch.index + fenceMatch[0].length;
    const closing = raw.indexOf('```', contentStart);
    const content =
      closing === -1 ? raw.slice(contentStart) : raw.slice(contentStart, closing);
    const parsed = closing === -1 ? null : parseJsonBlock(content);

    if (isDiffLike(content, parsed)) {
      junkStart = fenceMatch.index;
      inlineDiff = parsed && looksLikeStateDiff(parsed) ? parsed : null;

      if (closing !== -1) {
        FENCE_OPEN.lastIndex = closing + 3;
      }
    } else if (closing !== -1) {
      FENCE_OPEN.lastIndex = closing + 3;
    }
  }

  if (junkStart === -1) {
    DIFF_OBJECT_START.lastIndex = 0;
    let markerMatch: RegExpExecArray | null;
    let lastMarker = -1;

    while ((markerMatch = DIFF_OBJECT_START.exec(raw)) !== null) {
      const parsed = parseJsonBlock(raw.slice(markerMatch.index));

      if (parsed && looksLikeStateDiff(parsed)) {
        junkStart = markerMatch.index;
        inlineDiff = parsed;
        break;
      }

      lastMarker = markerMatch.index;
    }

    if (junkStart === -1 && lastMarker !== -1) {
      junkStart = lastMarker;
      inlineDiff = null;
    }
  }

  if (junkStart === -1) {
    return { narration: cleanNarration(raw), inlineDiff: null };
  }

  return {
    narration: cleanNarration(raw.slice(0, junkStart)),
    inlineDiff,
  };
}

function looksLikeStateDiff(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);

  if (keys.length === 0) {
    return false;
  }

  const knownKeys = [
    'state', 'bonds', 'facts', 'threads', 'new_characters', 'image_worthy',
  ];

  return keys.some((key) => knownKeys.includes(key));
}

function parseJsonBlock(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();

  if (!trimmed || trimmed === '{}') {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed);

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to the last-balanced-brace search.
  }

  const start = trimmed.indexOf('{');

  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;

      if (depth === 0) {
        try {
          const parsed = JSON.parse(trimmed.slice(start, index + 1));

          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          return null;
        }

        return null;
      }
    }
  }

  return null;
}

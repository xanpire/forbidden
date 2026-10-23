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

const NARRATION_SYSTEM = `You are the narrator and game master of an interactive novel set in the Naruto world. The player plays Kan. You control the world and every other character.

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
- Not every turn. Quiet in the middle of an emotional scene, more likely when Kan is traveling, on missions, or idle in the village.
- Encounters should have consequences and can be ignored by the player without breaking the story.

LITERARY NARRATION & REALISM
- Write in immersive, gritty third-person limited perspective. Show, don't tell: the guttering candlelight, the smell of damp rot, the heavy silence.
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
  "bonds": [{ "character": string, "affinity_change": number (-10..10 per turn, cumulative), "status": string, "note": string }],
  "facts": [{ "entity": string, "fact": string }],
  "threads": [{ "description": string, "status": "open" | "resolved" }],
  "new_characters": [{ "name": string, "age": number, "role": string, "personality": string, "speech_style": string, "appearance_block": string }],
  "image_worthy": boolean
}
\`\`\`
- Record only changes. If nothing changed, output \`\`\`json {} \`\`\` with no keys.
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
  const recentMessages = getRecentMessages(db, db.settings.contextMessages);
  const memories = retrieveMemories(
    db,
    { recentMessages, userMessage },
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
    `KAN'S ACTION:\n${userMessage}`,
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
    formatFacts(db.facts.filter((fact) => fact.validTo === null).slice(0, 20)),
    formatThreads(db),
  ].join('\n\n');

  const dynamic = [
    'LAST TURN',
    `Kan: ${userMessage}`,
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
    .map((message) => `${message.role === 'user' ? 'Kan' : 'Narrator'}: ${message.content}`)
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
    formatFacts(db.facts.filter((fact) => fact.validTo === null).slice(0, 20)),
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
    `Location: ${state.location}`,
    `Kan's mood: ${state.mood}`,
    `World: ${state.worldDescription}`,
    `Jutsu: ${state.jutsu.join(', ') || 'none'}`,
    `Inventory: ${state.inventory.join(', ') || 'none'}`,
    `Canon point: ${state.canonPoint}`,
    `Chapter: ${state.chapter}`,
    `Scene: ${state.scene}`,
  ].join('\n');
}

function formatEntities(db: AppDatabase) {
  const characters = db.entities
    .filter((entity) => entity.type === 'character')
    .slice(0, 20);

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

        return `- ${entity.name}${age !== undefined ? `, age ${age}` : ''}${entity.role ? `, ${entity.role}` : ''}: personality ${entity.personality ?? 'unknown'}; speech ${entity.speechStyle ?? 'unknown'}; mood ${entity.mood ?? 'unknown'}; appearance ${entity.appearance ?? 'unknown'}`;
      }
    ),
  ].join('\n');
}

function formatJutsu(db: AppDatabase) {
  const groups = groupJutsuByNature(db.jutsuRecords).slice(0, 8);

  if (groups.length === 0) {
    return 'KNOWN JUTSU\nNone.';
  }

  return [
    'KNOWN JUTSU',
    ...groups.map((group) => {
      const lines = group.jutsu
        .slice(0, 5)
        .map(
          (record) =>
            `  - ${record.name} (${record.user}): effect ${record.effect}; visual ${record.visual}`
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
        `- ${bond.characterName} (${bond.affinity}/10): ${bond.status}. ${bond.note}`
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
        `- ${fact.text}${fact.whoKnows.length > 0 ? ` (known by: ${fact.whoKnows.join(', ')})` : ''}`
    ),
  ].join('\n');
}

function formatThreads(db: AppDatabase) {
  const threads = db.threads.filter((thread) => thread.status === 'open').slice(0, 12);

  if (threads.length === 0) {
    return 'OPEN THREADS\nNone.';
  }

  return [
    'OPEN THREADS',
    ...threads.map((thread) => `- ${thread.title}: ${thread.description}`),
  ].join('\n');
}

function formatLore(lore: AppDatabase['loreEntries']) {
  if (lore.length === 0) {
    return '';
  }

  return [
    'RELEVANT LORE',
    ...lore.map((entry) => `- ${entry.text}`),
  ].join('\n');
}

function formatArcSummary(summary: string | null) {
  return `CURRENT ARC SUMMARY\n${summary ?? 'No arc summary yet.'}`;
}

function formatMemories(memories: EventRecord[]) {
  if (memories.length === 0) {
    return 'RELEVANT MEMORIES\nNone.';
  }

  return [
    'RELEVANT MEMORIES',
    ...memories.map((memory) => `- ${memory.summary}`),
  ].join('\n');
}

function formatRecentMessages(messages: RawLogEntry[]) {
  if (messages.length === 0) {
    return 'RECENT SCENE\nThe story is just beginning.';
  }

  return [
    'RECENT SCENE',
    ...messages.map(
      (message) => `${message.role === 'user' ? 'Kan' : 'Narrator'}: ${message.content}`
    ),
  ].join('\n');
}

function formatEncounterHint(d20: number) {
  let hint = 'nothing special happens';

  if (d20 >= 20) {
    hint = 'a major canon event or crisis occurs';
  } else if (d20 >= 17) {
    hint = 'a named canon character appears, if plausible for the timeline';
  } else if (d20 >= 9) {
    hint = 'a minor NPC or small event appears';
  }

  return `ENCOUNTER HINT (d20 ${d20}): ${hint}`;
}

export function splitNarrationAndDiff(raw: string): {
  narration: string;
  inlineDiff: Record<string, unknown> | null;
} {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/g;
  let lastBlock: string | null = null;
  let narrationEnd = raw.length;
  let match: RegExpExecArray | null;

  while ((match = fenced.exec(raw)) !== null) {
    lastBlock = match[1];
    narrationEnd = match.index;
  }

  if (lastBlock === null) {
    return { narration: raw.trim(), inlineDiff: null };
  }

  const parsed = parseJsonBlock(lastBlock);

  if (!parsed) {
    return { narration: raw.trim(), inlineDiff: null };
  }

  return {
    narration: raw.slice(0, narrationEnd).trim(),
    inlineDiff: parsed,
  };
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

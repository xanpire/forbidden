import { calculateAge, formatDate } from './calendar';
import { groupJutsuByNature } from './jutsu';
import { ROMANCE_RULES, eraNoteFor, loreProfileFor } from './romance';
import {
  activeCanonMilestones,
  canonEnabled,
  recentCanonEvents,
  recentlyConcludedMilestones,
  upcomingCanonMilestones,
  upcomingWorldMilestones,
  unheardCanonNews,
  hasHeardNews,
} from './canon';
import {
  formatEncounterConditions,
  formatGatedEncounterHint,
  locationKindOf,
} from './encounters';
import { estimateTokens } from '../openrouter';
import { PLACE_NAME_RULE, localizePlaceNames } from './glossary';
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

const PROMPT_TOKEN_BUDGET = 5600;

export const NARRATION_SYSTEM = `You are the narrator and game master of an interactive Naruto novel. The player plays Kan. You control the world and every other character.

EXECUTIVE RULES
- ${PLACE_NAME_RULE}
- You never speak, act, think, emote, or decide for Kan. Describe the world and NPC reactions, then stop the moment Kan must react. End every turn on a sensory hook, unanswered question, NPC line, or looming threat.
- Respect the in-story date. Characters are the age, rank, and position they would hold then, and know only what they could know at that point. Never reference future events.
- Canon power levels are real: no power creep, no convenient nerfing. Characters have their own goals and can refuse, lie, disagree, or leave. Trust and love must be earned.
- Canon happens on its canon timeline unless Kan plausibly changes it; then follow the consequences and record them as facts. If the provided context (facts, lore) contradicts canon, the context wins.

TIME IS STRICT
- The TIME block is the only source of the date. Never write a calendar date or day number yourself ("the fifth of October"). Use relative time: "the next day", "two nights later".
- When a new day begins in your narration, you MUST set days_passed to the number of days that actually elapsed.
- time_of_day must be the time the scene ENDS in: morning, afternoon, evening, or night. If the scene crosses into night, say night.

CANON TRUTH
- Never invent a canon event, funeral, death, battle, exam, summit, or date. If it is not in the CANON TIMELINE, NEWS & RUMORS, RUMORS OF WHAT'S COMING, or the facts, it has not happened yet.
- If Kan asks about something not yet listed, answer from the NPC's limited knowledge: it has not happened, they do not know, or they deflect. Never invent that it already occurred.

VOICE & STYLE
- Write clear, natural English for an ordinary reader: common words, short to medium sentences, one idea at a time. Vivid but not ornate — choose the plain word. Avoid rare or literary vocabulary.
- Use em dashes and semicolons sparingly; prefer periods.
- Keep imagery concrete and physical, but vary it every turn: different senses, textures, sounds, and metaphors.
- Never repeat a description, metaphor, or signature phrase you just used. Ban your own crutches.

WORLD & PACING
- Second person, immersive, gritty realism: gravity, fatigue, injury, weather, terrain, layout. Show moods through behavior and small choices. Quiet moments are allowed.
- Responses are 2-4 paragraphs. Do not fast-forward through conversations, combat, or travel unless Kan requests a skip. Compress uneventful travel into one or two paragraphs.
- Never repeat an NPC gesture, action, or line already used in the recent scene. Every beat must advance the story.
- Open threads are binding missions: never change a destination, objective, or ally mid-mission unless Kan decides to.
- Encounters are rare and follow the d20 hint and the ENCOUNTER CONDITIONS, never mentioning the roll. When the hint says no new people, add none — use animals, weather, sounds, tracks, or distant lights. Never put a cheerful stranger in isolated wilderness or an abandoned ruin at night. Never stack encounters or run two in a row.

NEW CHARACTERS
- Create original villagers, shinobi, merchants, clients, or enemies as needed. Give each a distinct name, age, role, personality, speech style, look, and goals. Keep them within canon power levels.

FORMATTING
- No meta-text, filler intros, end-of-turn summaries, or out-of-character commentary. Start directly with the narrative. Use clean quotation marks for speech; italics only for NPC thoughts when needed.
- Kan input markers: text in straight quotation marks is spoken aloud; text in asterisks is an action, gesture, or movement. A message may mix both.

MEMORY & CONTINUITY
- The supplied state, character cards, jutsu, bonds, facts ledger, threads, summaries, and memories are truth. Never contradict them. Honor bonds: treatment of Kan depends on affinity and history. Respect who-knows-what: characters know only secrets they learned in this story.
- IDENTITY: "the masked man", "Tobi", "Obito", and "the fake Madara" are ONE person, always the same entity. The REAL Madara Uchiha is a DIFFERENT character who appears only later; never merge them.
- MASKED MAN: the organization knows him as "Madara Uchiha" and he never shows his face to Itachi or Kan. Itachi dies still believing him to be Madara. The mask only shatters during the Fourth War against Kakashi and Naruto; only those present learn he is Obito. Before that, nobody knows or hints at his identity.
- PAIN: Pain is the Six Paths of Pain — six bodies (Deva, Asura, Animal, Human, Preta, Naraka) that are ONE entity controlled by Nagato. Never create separate path entities. Nagato is Pain's true identity and knows everything every body has seen or heard. Never merge Pain with the masked man or the real Madara.
- ZETSU: Black Zetsu and White Zetsu are two halves of one being, treated as one character "Zetsu". White Zetsu clones are expendable copies, not characters.

${ROMANCE_RULES}

CANON TIMELINE
- The world advances even when Kan is elsewhere. Events in the CANON TIMELINE are world truth; never re-narrate a completed event.
- Kan learns world events through witnesses, reports, gossip, briefings, couriers, or changed behavior. Never narrate omnisciently. The NEWS & RUMORS block lists events Kan has not learned; deliver them through a plausible bearer or channel and mark "news_relayed" with the speaker.
- If an ACTIVE STORY BEAT is listed and Kan's scene reaches it, play it out. If the beat fully happens, include "canon_engaged": ["<beat-id>"]. When a canon moment is fully dramatized, include "canon_completed": ["<id>"].

STATE OUTPUT (MANDATORY)
- After the narration, output exactly one fenced JSON block with changes only. If nothing changed, output \`\`\`json {} \`\`\`.
\`\`\`json
{
  "state": { "location": string, "location_kind": "settlement"|"road"|"wilderness"|"structure", "canon_point": string, "inventory_and_jutsu_changes": string[] },
  "time": { "days_passed": number, "time_of_day": "morning" | "afternoon" | "evening" | "night" },
  "mood": string,
  "world_description": string,
  "jutsu_used": [{ "name": string, "user": string, "chakra_nature": string, "effect": string, "visual": string }],
  "bonds": [{ "character": string, "affinity_change": number (-10..10, cumulative), "status": string, "note": string, "relationship": "stranger"|"friendly"|"close"|"romantic interest"|"partner"|"rejected", "attraction": "none"|"warm"|"strong", "romance_note": string }],
  "facts": [{ "entity": string, "fact": string }],
  "threads": [{ "description": string, "status": "open" | "resolved" }],
  "new_characters": [{ "name": string, "age": number, "role": string, "personality": string, "speech_style": string, "appearance_block": string }],
  "characters_present": string[],
  "image_brief": string,
  "canon_engaged": string[],
  "canon_completed": string[],
  "canon_passed": string[],
  "news_relayed": [{ "id": string, "from": string }],
  "scene_ended": boolean,
  "image_worthy": boolean
}
\`\`\`
- time: days_passed is 0 if the scene continues immediately, 1 for a scene break, more for travel or skips. Sleeping through the night means days_passed 1 and time_of_day "morning".
- Set state.location whenever Kan moves; always pair it with location_kind (settlement, road, wilderness, structure).
- characters_present lists ONLY characters physically in the scene this beat, never people merely mentioned (omit when Kan is alone).
- image_brief: one short sentence naming the exact visual action — who does what to whom, and where. Example: "Kan chokes a Stone ninja from behind at the quarry gate; the ninja's face reddens." Write it only for visually striking beats; keep it to 30 words.
- mood is Kan's mood in 1-3 words, only when changed. world_description is one sentence, only when changed. scene_ended is true only when the scene clearly concluded.
- jutsu_used only for named jutsu; chakra_nature must be Fire, Water, Wind, Earth, Lightning, Wood, Ice, Lava, Boil, Storm, Yin, Yang, Yin-Yang, Physical, Genjutsu, Space-Time, or Unknown.
- relationship/attraction/romance_note only when they changed. Bonds only for important characters; minor ones go in facts. image_worthy only for visually striking moments, never pure dialogue.`;

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
    { "character": string, "affinityDelta": number, "status": string, "note": string, "isMajor": boolean, "relationship": "stranger" | "friendly" | "close" | "romantic interest" | "partner" | "rejected", "attraction": "none" | "warm" | "strong", "romanceNote": string }
  ],
  "facts": [
    { "action": "add" | "end", "type": "death" | "injury" | "secret" | "knowledge" | "membership" | "possession" | "event" | "other", "text": string, "subject": string, "whoKnows": string[], "validFrom": { "year": number, "month": number, "day": number, "timeOfDay": "morning" | "afternoon" | "evening" | "night" } }
  ],
  "threads": [
    { "action": "open" | "update" | "resolve", "title": string, "description": string, "type": "promise" | "debt" | "grudge" | "mystery" | "quest" | "goal" | "other", "participants": string[] }
  ],
  "canonCompleted": string[],
  "canonEngaged": string[],
  "canonPassed": string[],
  "newsRelayed": [{ "id": string, "from": string }],
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
- If a scene clearly ended, set scene.ended to true and provide a one-sentence scene.summary.
- bonds.relationship: only set when the relationship stage visibly changed this scene; use one of stranger, friendly, close, romantic interest, partner, rejected.
- bonds.attraction: only set when attraction visibly changed; one of none, warm, strong.
- bonds.romanceNote: one short line about a romance development, only when one happened.
- canonCompleted / canonEngaged: copy the ids from the ACTIVE or PENDING story beats shown in the CANON TIMELINE if they fully played out in this scene.`;

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

  const buildDynamic = (messagesForScene: RawLogEntry[]) =>
    [
      formatArcSummary(arcSummary),
      formatTimeLine(db),
      formatNewsBlock(db),
      formatUpcomingWorldBlock(db),
      formatCanonBlock(db),
      formatMemories(memories),
      formatStyleGuard(db),
      formatRecentMessages(messagesForScene),
      formatLastBeat(messagesForScene),
      `${formatEncounterConditions(db)}\n${formatGatedEncounterHint(db, d20)}`,
      `CONTINUITY: continue directly from the last narrated beat. Never repeat a beat you already wrote and never contradict it. Location type: ${locationKindOf(db)}.`,
      `YOU (KAN) DO OR SAY:\n${userMessage}`,
    ].join('\n\n');

  let sceneMessages = recentMessages;
  let dynamic = buildDynamic(sceneMessages);
  let messages: OpenRouterMessage[] = [
    { role: 'system', content: stable },
    { role: 'user', content: dynamic },
  ];
  let estimated = estimateTokens(messages);

  // Hard prompt budget: trim the oldest scene messages rather than let the
  // prompt creep upward over a long story.
  while (estimated > PROMPT_TOKEN_BUDGET && sceneMessages.length > 4) {
    sceneMessages = sceneMessages.slice(1);
    dynamic = buildDynamic(sceneMessages);
    messages = [
      { role: 'system', content: stable },
      { role: 'user', content: dynamic },
    ];
    estimated = estimateTokens(messages);
  }

  const localizedMessages: OpenRouterMessage[] = messages.map((message) => ({
    ...message,
    content: localizePlaceNames(message.content),
  }));

  return {
    messages: localizedMessages,
    estimatedTokens: estimateTokens(localizedMessages),
    memories,
    recentMessages: sceneMessages,
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
        `- ${entity.name}${entity.aliases.length > 0 ? ` (also called ${entity.aliases[0]})` : ''}${entity.role ? ` (${truncate(entity.role, 40)})` : ''}: personality ${truncate(entity.personality ?? 'unknown', 60)}; speech ${truncate(entity.speechStyle ?? 'unknown', 50)}; mood ${truncate(entity.mood ?? 'unknown', 60)}; appearance ${truncate(entity.appearance ?? 'unknown', 80)}${formatLoreProfile(entity.name, db.state.inStoryDate.year)}`
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
        `- ${bond.characterName} (${bond.affinity}/10): ${truncate(bond.status ?? 'unknown', 50)}. ${truncate(bond.note, 80)}${bond.relationship ? ` [relationship: ${bond.relationship}${bond.attraction && bond.attraction !== 'none' ? `, attraction: ${bond.attraction}` : ''}]` : ''}`
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

function formatUpcomingWorldBlock(db: AppDatabase) {
  const upcoming = upcomingWorldMilestones(db, 10);

  if (upcoming.length === 0) {
    return '';
  }

  const lines = ["RUMORS OF WHAT'S COMING (planned, NOT yet happened)"];

  for (const item of upcoming) {
    lines.push(
      `- ${item.milestone.title} — about ${item.daysUntil} day(s) away, in ${item.milestone.era}. The world is preparing for it. NPCs may mention preparations or rumors, but must never say it has already happened.`
    );
  }

  return lines.join('\n');
}

const STYLE_STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'almost', 'along', 'already', 'also', 'although', 'always',
  'another', 'around', 'because', 'before', 'behind', 'being', 'below', 'between', 'beyond',
  'could', 'would', 'should', 'there', 'their', 'these', 'those', 'through', 'under', 'until',
  'where', 'which', 'while', 'within', 'without', 'still', 'every', 'never', 'other', 'something',
  'someone', 'nothing', 'little', 'moment', 'slowly', 'quietly', 'toward', 'towards', 'across',
  'first', 'right', 'voice', 'hands', 'eyes', 'face', 'world', 'story', 'scene', 'narrator',
  'you', 'your', 'yours', 'they', 'them', 'then', 'than', 'that', 'this', 'with', 'from', 'into',
  'have', 'has', 'had', 'were', 'was', 'are', 'will', 'been', 'over', 'just', 'like', 'make', 'made',
  'more', 'most', 'some', 'such', 'only', 'even', 'back', 'down', 'away', 'very', 'much', 'many',
  'chakra', 'sharingan', 'kunai', 'shinobi', 'jutsu', 'anbu', 'akatsuki', 'hokage', 'hidden',
  'leaf', 'rain', 'sand', 'mist', 'stone', 'cloud', 'sound',
]);

function formatStyleGuard(db: AppDatabase) {
  const recent = db.rawLog
    .filter((entry) => entry.kind === 'story' && entry.role === 'assistant')
    .slice(-6)
    .map((entry) => stripNarrationJson(entry.content).toLowerCase());

  if (recent.length < 2) {
    return '';
  }

  const nameWords = new Set(
    db.entities.flatMap((entity) => entity.name.toLowerCase().split(/\s+/))
  );
  const wordCounts = new Map<string, number>();
  const phraseCounts = new Map<string, number>();

  for (const text of recent) {
    const tokens = (text.match(/[a-z]{4,}/g) ?? []).filter(
      (word) => !STYLE_STOP_WORDS.has(word) && !nameWords.has(word)
    );

    for (let index = 0; index < tokens.length; index += 1) {
      const word = tokens[index];
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);

      if (index + 1 < tokens.length) {
        const phrase = `${word} ${tokens[index + 1]}`;
        phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
      }
    }
  }

  const overusedWords = [...wordCounts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  const overusedPhrases = [...phraseCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([phrase]) => phrase);

  if (overusedWords.length === 0 && overusedPhrases.length === 0) {
    return '';
  }

  const wordText = overusedWords.length > 0 ? `words: ${overusedWords.join(', ')}` : '';
  const phraseText =
    overusedPhrases.length > 0 ? `phrases: ${overusedPhrases.map((phrase) => `"${phrase}"`).join('; ')}` : '';

  return `STYLE GUARD — recently overused, avoid this turn: ${[wordText, phraseText].filter(Boolean).join('. ')}. Choose fresh sensory detail.`;
}

function formatNewsBlock(db: AppDatabase) {
  if (!canonEnabled(db)) {
    return '';
  }

  const news = unheardCanonNews(db, 3);

  if (news.length === 0) {
    return '';
  }

  const lines = ['NEWS & RUMORS (events Kan has NOT learned yet)'];

  for (const item of news) {
    const urgency =
      item.major && item.daysOld >= 7
        ? ' OVERDUE: deliver this through the courier channel now — a crow, hawk, paper butterfly, or rider arriving with word.'
        : '';

    const bearerText =
      item.bearers.length > 0
        ? `Could be known by ${item.bearers.slice(0, 4).join(', ')}.`
        : 'Only someone present could know.';

    lines.push(
      `- ${item.title} (${item.location}, ${item.region}). ${bearerText} Channel: ${item.channel}.${urgency}`
    );
    lines.push(
      `  If a bearer is present or Kan is somewhere news reaches, let it surface naturally in dialogue or a report. Never narrate it omnisciently. When told, set "news_relayed": [{ "id": "${item.milestoneId}", "from": "<speaker>" }].`
    );
  }

  return lines.join('\n');
}

function formatCanonBlock(db: AppDatabase) {
  if (!canonEnabled(db)) {
    return '';
  }

  const active = activeCanonMilestones(db).slice(0, 2);
  const upcoming = upcomingCanonMilestones(db, 1);
  const concluded = recentlyConcludedMilestones(db, 3);
  const recent = recentCanonEvents(db, 6).filter((event) => hasHeardNews(db, event.id)).slice(0, 3);
  const lines: string[] = ['CANON TIMELINE'];

  if (recent.length > 0) {
    lines.push(
      ...recent.map(
        (event) =>
          `- World event (${formatDate(event.inStoryDate)}): ${truncate(event.summary, 110)}`
      )
    );
  } else {
    lines.push('- No world events recorded yet; the world is quiet.');
  }

  for (const beat of upcoming) {
    lines.push(
      `PERSONAL STORY BEAT — do not assume it happened (${beat.id}, era ${beat.era}): ${truncate(beat.title, 70)} — ${truncate(beat.description, 130)}`
    );
    lines.push(
      '  This only occurs if Kan actually does it in the scene. Never state it has happened because time passed.'
    );
  }

  if (active.length > 0) {
    for (const milestone of active) {
      lines.push(
        `ACTIVE STORY BEAT (${milestone.id}): ${truncate(milestone.title, 70)}`
      );

      if (milestone.encounter) {
        lines.push(
          `  Encounter opportunity: ${milestone.encounter.who} — ${milestone.encounter.where}. ${truncate(milestone.encounter.context, 180)}`
        );
      }

      lines.push(
        '  If this beat plays out in your scene, set "canon_engaged": [id]. If fully dramatized, set "canon_completed": [id]. If the opportunity clearly passed (Kan left, time moved on), set "canon_passed": [id].'
      );
    }
  }

  if (concluded.length > 0) {
    lines.push(
      'RECENTLY CONCLUDED (finished — never replay these): ' +
        concluded
          .map((milestone) => `${milestone.id} (${truncate(milestone.title, 50)})`)
          .join('; ')
    );
  }

  return lines.join('\n');
}

function formatLoreProfile(name: string, year: number) {
  const profile = loreProfileFor(name);

  if (!profile) {
    return '';
  }

  const era = eraNoteFor(name, year);

  return `; heart: ${truncate(profile.canonDevotion, 90)} (${profile.romanceAccessibility})${era ? `; now: ${truncate(era, 80)}` : ''}`;
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

function tail(value: string, maxLength: number) {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return `…${value.slice(-maxLength).trimStart()}`;
}

function formatRecentMessages(messages: RawLogEntry[]) {
  if (messages.length === 0) {
    return 'RECENT SCENE\nThe story is just beginning.';
  }

  const lastAssistantIndex = [...messages]
    .map((message, index) => (message.role === 'assistant' ? index : -1))
    .filter((index) => index >= 0)
    .pop();

  return [
    'RECENT SCENE (oldest first)',
    ...messages.map((message, index) => {
      if (message.role === 'user') {
        return `You (Kan): ${truncate(message.content, 500)}`;
      }

      const clean = stripNarrationJson(message.content);
      const cap = index === lastAssistantIndex ? 2200 : 1000;

      return `Narrator: ${tail(clean, cap)}`;
    }),
  ].join('\n');
}

function formatLastBeat(messages: RawLogEntry[]) {
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');

  if (!lastAssistant) {
    return 'LAST NARRATED BEAT\nThe story is just beginning.';
  }

  const clean = stripNarrationJson(lastAssistant.content).trim();

  return `LAST NARRATED BEAT (continue directly from here)\n${tail(clean, 450)}`;
}

function formatTimeLine(db: AppDatabase) {
  const stalled = db.state.turnsWithoutTimeChange ?? 0;
  const nudge =
    stalled >= 1
      ? ' — several beats have passed without the clock moving; let time advance naturally.'
      : '';

  return `TIME\n${formatDate(db.state.inStoryDate)}${nudge}`;
}

export function formatEncounterHint(d20: number) {
  let hint = 'nothing special happens; keep the turn quiet';

  if (d20 >= 20) {
    hint = 'a major canon event stirs — check the CANON TIMELINE and pull the nearest pending beat or world event into the scene if plausible';
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

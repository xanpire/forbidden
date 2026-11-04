import { calculateAge, entityAge, formatDate } from './calendar';
import { groupJutsuByNature } from './jutsu';
import { ROMANCE_RULES, eraNoteFor, loreProfileFor } from './romance';
import { endgameNote } from './canonEndgame';
import { characterRefs, mentionsEntity, refByEntityId } from './characterRefs';
import {
  activeCanonMilestones,
  recentCanonEvents,
  recentlyConcludedMilestones,
  upcomingCanonMilestones,
  PERSONAL_OFFERS_PER_TURN,
  upcomingWorldMilestones,
  isCombatPace,
  hasHeardNews,
} from './canon';
import { formatNewsOffer, newsOffer, newsTrackingLines } from './newsDelivery';
import { formatLetterOffer, letterOffer, letterTrackingLines } from './letters';
import {
  formatEncounterConditions,
  locationKindOf,
} from './encounters';
import { formatReturningCharacter } from './returning';
import { GRUDGE_RULES, formatGrudgeOffer, grudgeOffer, grudgeStage, grudgeTrackingLines } from './grudges';
import { formatHunterOffer, formatReputationBlock, hunterOffer, reputationTrackingLines } from './reputation';
import { estimateTokens } from '../openrouter';
import { DEFAULT_SETTINGS } from './defaults';
import { PLACE_NAME_RULE, localizePlaceNames } from './glossary';
import { isDeceased, kanKnowsDeath } from './deaths';
import { companionsOf, daysTogether, formatTogether } from './companions';
import { relevantFacts, retrieveMemories, triggeredLore } from './retrieval';
import type {
  AppDatabase,
  EntityRecord,
  EventRecord,
  FactRecord,
  OpenRouterMessage,
  RawLogEntry,
} from './types';

const MIN_SCENE_MESSAGES = 4;
const STORY_CHAPTERS = 3;

export const NARRATION_SYSTEM = `You narrate an interactive Naruto novel. The player is Kan; you run the world and everyone else.

CORE
- Never speak, act, think, or decide for Kan. Describe the world and the reactions, then stop where Kan must respond. End on a hook: a sound, a question, an NPC line, a threat.
- ${PLACE_NAME_RULE}
- The dead stay dead. Anyone under THE DEAD never appears alive, speaks, or acts: only as a memory, a dream, a grave, or a body, or through a revival or reanimation the canon timeline allows. Where it says Kan does not know yet, never reveal the death through narration; he learns it only through someone who could know.
- Anyone under TRAVELLING WITH KAN is physically at his side in every scene until the story shows them leave: give each of them a real presence every turn (a line, a look, an action, a judgment of their own) in their own voice. They never vanish, wander off unexplained, or get forgotten; they part ways only when the story makes it happen (they choose to go, Kan sends them away, they are called away, captured, or killed). What they live through beside Kan, good or bad, changes how they feel about him. Someone joins only when the story makes it clear they are coming along.
- Characters have the age, rank, and knowledge they would have on the current date, and goals of their own: they can refuse, lie, or leave. Canon power levels hold, with no power creep or nerfing. Trust and love are earned.
- The supplied state, characters, bonds, facts, threads, summaries, and memories are truth, and win over canon where they differ. Characters know only the secrets they learned in this story. Open threads are binding: never change a mission's goal, destination, or allies unless Kan does.

TIME
- The TIME block is the only date. Never write a calendar date; use relative time ("the next morning", "two nights later"). Name an exact hour only when the story fixes one.
- Say plainly how long things take ("a few heartbeats", "an hour later", "by dusk", "after a full night's sleep", "three days on the road"); the app reads the clock from your words. Be honest: blows take seconds, talks minutes, battles minutes to hours, a nap under an hour, a night's sleep 8-9 hours. Never skip time in a fight; Kan controls each move.

CANON
- Canon happens on schedule unless Kan plausibly changes it. Nothing has happened unless it is in the CANON TIMELINE, NEWS & RUMORS, RUMORS OF WHAT'S COMING, or the facts: never invent a canon death, battle, exam, or date. Asked about anything else, NPCs say it hasn't happened, don't know, or deflect.
- The world moves while Kan is elsewhere, but he learns of it only through people, reports, couriers, or gossip, never omniscient narration. Deliver NEWS & RUMORS through a plausible bearer, preferring someone already in the scene, in the delivery given, and make clear who told him: at most one piece of news per turn (a CATCH-UP report is one report covering several), and none in the middle of a fight. Never re-narrate a finished event. If the scene reaches an ACTIVE STORY BEAT, play it out fully.
- Letters are personal, never canon news. A LETTER FOR YOU arrives the way it says, in its writer's own voice. When Kan writes to someone far away, show him send it (a bird, a courier, a dead drop); it takes days to arrive, so any answer comes much later, never in the same scene.
- The masked man, Tobi, Obito, and "the fake Madara" are one person. The Akatsuki know him as Madara; he never unmasks before Itachi or Kan, and Itachi dies believing it. Only those present when his mask breaks in the Fourth War, against Kakashi and Naruto, learn he is Obito. The real Madara is a separate character who appears later.
- Pain is one entity, Nagato, acting through six bodies (Deva, Asura, Animal, Human, Preta, Naraka) that share all they see. Zetsu, Black and White, is one character; White Zetsu clones are expendable copies.

STYLE
- Second person, gritty realism: weight, fatigue, injury, weather, terrain. Show moods through behavior. Quiet moments are fine.
- 2-4 paragraphs of plain English: common words, short to medium sentences, few em dashes or semicolons. Concrete imagery, but never reuse a description, metaphor, gesture, or line from the recent scene. Every beat moves the story.
- Play out conversations, fights, and travel unless Kan asks to skip; compress uneventful travel into a paragraph or two.
- Encounters are rare and must fit the ENCOUNTER CONDITIONS (place, hour, how crowded). Most turns bring no new people; when a place is isolated, use animals, weather, sounds, or tracks. No cheerful strangers in empty wilderness or ruins at night, and never two encounters in a row.
- New characters get a distinct name, age, role, personality, voice, look, and goals, within canon power levels.
- In Kan's input, "quoted text" is spoken and *asterisks* are actions.

${ROMANCE_RULES}

${GRUDGE_RULES}

OUTPUT
- Story prose only, starting straight in the scene: no JSON, code, lists, headings, labels, summaries, or out-of-character notes. Speech in quotation marks; italics only for NPC thoughts.
- The app tracks state from your prose, so make changes clear in it: where Kan goes, who is there, which jutsu are used and how they look, what is learned or promised, and when a scene ends.`;

const STATE_SYSTEM = `You are the state tracker for an interactive Naruto novel; the player is Kan. Read the narrator's latest turn and return one JSON object matching the schema. Never write story text.

- Report only what THIS turn shows changed: null when unchanged, [] when empty. Never invent anything or contradict the state below.
- Player-facing text calls Kan "you" (world_description, canon_point, threads, bond status and notes, jutsu effects). Use "Kan" in facts and the jutsu "user" field.

TIME: time.elapsed + time.unit is the in-story time this turn covered, read from the prose. Blows take seconds, talks minutes, battles minutes to hours, a nap under an hour, a night's sleep 8-9 hours, travel minutes to days; a new day must be covered. time.clock_time is "HH:MM" only when the prose fixes an hour. scene_pace: combat, chase, conversation, travel, or downtime.

PLACE: location, with location_kind, when Kan moves. mood (1-3 words), world_description (one sentence), and canon_point (one line) only when changed. inventory_added / inventory_removed.

PEOPLE: refer to every person by their id from KNOWN CHARACTERS (Kan is "kan") in characters_present, bonds.character_id, character_updates.character_id, facts.entity, facts.who_knows, jutsu_used.user, news_relayed.from, letters_sent.to, letters_received, and grudges.character_id. Match every name, title, nickname, and alias against KNOWN CHARACTERS first ("Kisame", "Hoshigaki", and "the shark-faced swordsman" are all kisame-hoshigaki), including people Kan has not met yet. new_characters is ONLY for a named person missing from KNOWN CHARACTERS: is_new true, their fullest known name, age, role, personality, speech, and appearance; elsewhere this turn, refer to them by that exact name. Never put a listed person in new_characters. characters_present lists only those physically in the scene at the end; [] if Kan is alone. character_updates: visible mood or appearance changes. bonds: only important characters whose feelings toward Kan shifted (affinity_change -10..10; relationship, attraction, romance_note only if changed); minor people go in facts.

COMPANIONS: people marked [travelling with Kan] are with him in every scene; always list them in characters_present. companions_joined lists, by id, someone who clearly sets out with Kan this turn (agrees to come along, is assigned as his partner, leaves with him), with a short reason; companions_left lists a companion who truly parts ways (leaves, is sent away, called back, captured, or splits off on their own mission), with a short reason. Scouting ahead, sleeping in the next room, or a short errand is not leaving. Companions share what happens to Kan: give a companion a bonds entry whenever this turn's shared events move how they feel about him (fighting side by side, being protected or saved, a secret shared, kindness, an argument, a betrayal); affinity_change usually -3..3.

DEATHS: deaths lists, by id, anyone the prose makes certain is dead this turn: they die on screen, Kan sees the body, or someone tells Kan they died (also for someone already marked deceased whom Kan did not know about). Never for someone unconscious, missing, faking, or only rumored dead. The dead are never in characters_present or bonds. revived lists ids only for a true return to life (like Chiyo's or Nagato's revival jutsu); an Edo Tensei reanimation is still dead.

JUTSU: jutsu_used lists every named jutsu, by anyone. chakra_nature is Fire, Water, Wind, Earth, Lightning, Wood, Ice, Lava, Boil, Storm, Yin, Yang, Yin-Yang, Physical, Genjutsu, Space-Time, or Unknown; for a blend pick the primary and describe the blend. Keep effect and visual short and consistent with earlier uses.

MEMORY: facts are lasting truths (a death, injury, secret, membership, key item or event) with who_knows. threads are promises, debts, grudges, mysteries, quests, or goals: "open" for new, "update" or "resolved" reusing the exact title. scene_ended is true only when the scene clearly concluded.

CANON: canon_engaged / canon_completed / canon_passed / news_relayed use ids exactly as listed under CANON TRACKING, only when that id's rule is met; otherwise []. A catch-up report can relay several listed news ids in one turn.

LETTERS: letters_sent and letters_received use character ids, by the rules under LETTERS; otherwise [].

NAME & ENEMIES: reputation, bounty_seen, and grudges follow the rules under REPUTATION & GRUDGES; otherwise [].

IMAGE: image_worthy is true only for visually striking moments, never pure dialogue.`;

const SUMMARY_SYSTEM = `You are a story summarizer for a long-running interactive novel.

Write a 100-150 word summary of the supplied scene.
- Second person, present tense: Kan is "you" ("You follow Itachi north"). Everyone else is named.
- Concrete and specific.
- No meta-text, no commentary, no greeting.
- Mention the most important NPCs, your choices, and the consequences.
- Preserve any timeline information.`;

const ARC_SUMMARY_SYSTEM = `You are a story archivist for a long-running interactive novel.

Combine the supplied chapter summaries into one compact arc summary.
- 120-180 words.
- Second person, present tense: Kan is "you". Everyone else is named.
- Keep cause and effect clear.
- Preserve names, dates, and major consequences.
- No meta-text.`;

const TIME_SKIP_SYSTEM = `You are a time-skip narrator for a long-running interactive novel.

Write 100-150 words describing what happened meanwhile during the supplied time skip.
- Second person, present tense: Kan is "you". Everyone else is named.
- Focus on your off-screen growth as Kan, NPC changes, and world movement.
- Respect the facts and bonds provided.
- No meta-text.`;

export function buildNarrationPrompt(
  db: AppDatabase,
  userMessage: string
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
  // Companions are in every scene, so their character cards always come along.
  const matchedEntityIds = new Set([
    ...companionsOf(db).map((entity) => entity.id),
    ...db.entities
      .filter((entity) => mentionsEntity(entityText, entity))
      .map((entity) => entity.id),
  ]);
  const facts = relevantFacts(db, matchedEntityIds, entityText);
  const lore = triggeredLore(db, entityText);
  const storySoFar = getStorySoFar(db);
  const shownSummaries = new Set(
    [storySoFar.arc, ...storySoFar.chapters].filter((text): text is string => Boolean(text))
  );
  // A memory saved from a summary that is already shown would only repeat it.
  const freshMemories = memories.filter((memory) => !shownSummaries.has(memory.summary));
  const arcSummary = storySoFar.arc ?? storySoFar.chapters[storySoFar.chapters.length - 1] ?? null;

  // Ordered from never-changing to changing-every-turn, so the front of the
  // prompt is a stable prefix that providers can cache (cache reads cost a
  // fraction of fresh input).
  // 1. The rules: identical on every turn of every story.
  const rules = NARRATION_SYSTEM;
  // 2. Who Kan is and the long view: changes only when a summary lands, a
  //    jutsu is learned, a thread opens or closes, or a bond moves.
  const slow = [
    formatCharacterSheet(db),
    formatStorySoFar(storySoFar),
    formatJutsu(db),
    formatThreads(db),
    formatBonds(db),
    formatTheDead(db),
  ].filter(Boolean).join('\n\n');

  // 3. Everything that moves turn to turn.
  const buildDynamic = (messagesForScene: RawLogEntry[]) =>
    [
      formatState(db),
      formatCompanions(db),
      formatTimeLine(db),
      formatMatchedEntities(db, matchedEntityIds),
      formatFacts(facts),
      formatLore(lore),
      formatNewsBlock(db),
      formatLetterBlock(db),
      formatUpcomingWorldBlock(db),
      formatCanonBlock(db),
      formatMemories(freshMemories),
      formatRecentMessages(messagesForScene),
      formatLastBeat(messagesForScene),
      formatEncounterConditions(db),
      formatReputationBlock(db),
      // At most one outside pressure per turn: a grudge first, then a
      // bounty hunter, then a familiar face.
      formatPressure(db, entityText),
      `CONTINUITY: continue directly from the last narrated beat. Never repeat a beat you already wrote and never contradict it. Location type: ${locationKindOf(db)}.`,
      `YOU (KAN) DO OR SAY:\n${userMessage}`,
    ]
      .filter(Boolean)
      .join('\n\n');

  const assemble = (messagesForScene: RawLogEntry[]): OpenRouterMessage[] => {
    const ruleText = localizePlaceNames(rules);
    const slowText = localizePlaceNames(slow);

    return [
      {
        role: 'system',
        content: `${ruleText}\n\n${slowText}`,
        parts: [
          { text: `${ruleText}\n\n`, cache: true },
          { text: slowText, cache: true },
        ],
      },
      { role: 'user', content: localizePlaceNames(buildDynamic(messagesForScene)) },
    ];
  };

  const budget = db.settings.promptTokenBudget ?? DEFAULT_SETTINGS.promptTokenBudget;
  let sceneMessages = recentMessages;
  let messages = assemble(sceneMessages);
  let estimated = estimateTokens(messages);

  // Prompt budget: drop the oldest scene messages rather than let the prompt
  // creep upward over a long story.
  while (estimated > budget && sceneMessages.length > MIN_SCENE_MESSAGES) {
    sceneMessages = sceneMessages.slice(1);
    messages = assemble(sceneMessages);
    estimated = estimateTokens(messages);
  }

  return {
    messages,
    estimatedTokens: estimated,
    memories: freshMemories,
    recentMessages: sceneMessages,
    arcSummary,
  };
}

/**
 * Call 2 of a turn: a cheap model reads the narrator's prose and returns the
 * state change as structured JSON (see stateSchema.ts).
 */
export function buildExtractionPrompt(
  db: AppDatabase,
  userMessage: string,
  assistantMessage: string
) {
  const previousBeat = [...getRecentMessages(db, 6)]
    .reverse()
    .find((message) => message.role === 'assistant' && message.content !== assistantMessage);

  const stable = [
    formatCharacterRoster(db),
    formatJutsu(db),
    formatBonds(db),
    formatFacts(db.facts.filter((fact) => fact.validTo === null).slice(0, 10)),
    formatThreads(db),
  ].join('\n\n');

  const dynamic = [
    formatState(db),
    formatCompanionIds(db),
    formatCharacterDetails(db, `${userMessage}\n${assistantMessage}`),
    formatTimeLine(db, 'state'),
    formatCanonTracking(db),
    formatLetterTracking(db),
    formatEnemyTracking(db),
    previousBeat
      ? `PREVIOUS BEAT (context only — already recorded)\n${tail(stripNarrationJson(previousBeat.content), 500)}`
      : '',
    'THIS TURN',
    `You (Kan): ${userMessage}`,
    `Narrator: ${assistantMessage}`,
    'Report the state change for THIS TURN now.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: OpenRouterMessage[] = [
    {
      role: 'system',
      content: `${STATE_SYSTEM}\n\n${stable}`,
      parts: [{ text: `${STATE_SYSTEM}\n\n`, cache: true }, { text: stable }],
    },
    { role: 'user', content: dynamic },
  ];

  return {
    messages,
    estimatedTokens: estimateTokens(messages),
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

type StorySoFar = {
  arc: string | null;
  /** Newest chapter summaries, oldest first. */
  chapters: string[];
};

/**
 * The latest arc summary plus the last few chapter summaries. Chapters the arc
 * already covers are skipped, unless that would leave fewer than two.
 */
function getStorySoFar(db: AppDatabase): StorySoFar {
  const byAge = (a: { createdAt: number }, b: { createdAt: number }) => a.createdAt - b.createdAt;
  const arc = db.summaries.filter((summary) => summary.level === 'arc').sort(byAge).pop() ?? null;
  const chapters = db.summaries.filter((summary) => summary.level === 'chapter').sort(byAge);
  const covered = new Set(arc?.sourceSummaryIds ?? []);
  let picked = chapters.filter((summary) => !covered.has(summary.id)).slice(-STORY_CHAPTERS);

  if (picked.length < 2) {
    picked = chapters.slice(-2);
  }

  return { arc: arc?.text ?? null, chapters: picked.map((summary) => summary.text) };
}

function formatStorySoFar(story: StorySoFar) {
  if (!story.arc && story.chapters.length === 0) {
    return 'STORY SO FAR\nThe story is just beginning.';
  }

  return [
    'STORY SO FAR',
    story.arc ? `Arc: ${truncate(story.arc, 1200)}` : '',
    ...story.chapters.map((text, index) =>
      `${index === story.chapters.length - 1 ? 'Latest chapter' : 'Chapter'}: ${truncate(text, 1000)}`
    ),
  ]
    .filter(Boolean)
    .join('\n');
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

/**
 * Who travels with Kan, for the narrator: they are in every scene. Changes
 * only by the day count, so it sits right after the state block.
 */
function formatCompanions(db: AppDatabase) {
  const companions = companionsOf(db);

  if (companions.length === 0) {
    return '';
  }

  const bonds = new Map(db.bonds.map((bond) => [bond.entityId, bond]));

  return [
    'TRAVELLING WITH KAN (at his side in every scene until the story shows them leave)',
    ...companions.map((entity) => {
      const bond = bonds.get(entity.id);
      const companion = entity.companion!;
      const days = daysTogether(db, entity);
      const together = days <= 0 ? 'joined today' : `together ${formatTogether(days)}`;
      const how = [companion.reason, companion.sinceLocation ? `from ${companion.sinceLocation}` : null]
        .filter(Boolean)
        .join(', ');
      const feeling = bond
        ? `; feels ${bond.affinity > 0 ? '+' : ''}${bond.affinity}/10 toward Kan${bond.relationship && bond.relationship !== 'stranger' ? ` (${bond.relationship})` : ''}${bond.note ? `: ${truncate(bond.note, 70)}` : ''}`
        : '';

      return `- ${entity.name}: ${together}${how ? ` (${truncate(how, 80)})` : ''}, ${companion.sharedScenes} scene${companion.sharedScenes === 1 ? '' : 's'} shared${feeling}`;
    }),
  ].join('\n');
}

/** The same, for the state tracker: ids it must keep in characters_present. */
function formatCompanionIds(db: AppDatabase) {
  const companions = companionsOf(db);
  const refByEntity = refByEntityId(db);

  return `TRAVELLING WITH KAN: ${
    companions.length > 0
      ? companions.map((entity) => `${refByEntity.get(entity.id)} (${entity.name})`).join(', ')
      : 'nobody'
  }`;
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
    // Companions first, so a crowded scene never cuts them.
    .sort((a, b) => Number(Boolean(b.companion)) - Number(Boolean(a.companion)))
    .slice(0, 6);

  if (characters.length === 0) {
    return '';
  }

  return [
    'CHARACTERS IN SCENE',
    ...characters.map(
      (entity) =>
        `- ${entity.name}${entity.aliases.length > 0 ? ` (also called ${entity.aliases[0]})` : ''}${entity.role ? ` (${truncate(entity.role, 40)})` : ''}${isDeceased(entity) ? ` [DECEASED${kanKnowsDeath(db, entity) ? '' : ', Kan does not know yet'}]` : ''}: personality ${truncate(entity.personality ?? 'unknown', 60)}; speech ${truncate(entity.speechStyle ?? 'unknown', 50)}; mood ${truncate(entity.mood ?? 'unknown', 60)}; appearance ${truncate(entity.appearance ?? 'unknown', 80)}${formatLoreProfile(db, entity.name)}`
    ),
  ].join('\n');
}

/**
 * Everyone the state tracker can refer to, by ID. Stable from turn to turn
 * (it only changes when someone is added, merged or renamed), so it sits in
 * the cached part of the prompt.
 */
function formatCharacterRoster(db: AppDatabase) {
  const refs = [...characterRefs(db)];

  if (refs.length === 0) {
    return 'KNOWN CHARACTERS\nNone.';
  }

  return [
    'KNOWN CHARACTERS (id: name, other names) — refer to people by id; anyone listed already exists',
    ...refs.map(([ref, entity]) => {
      const others = entity.aliases.filter((alias) => alias.toLowerCase() !== entity.name.toLowerCase()).slice(0, 4);
      const notes = [
        entity.name.toLowerCase() === 'kan' ? 'the player' : null,
        entity.met === false ? 'not met yet' : null,
        entity.companion && !isDeceased(entity) ? 'travelling with Kan' : null,
        isDeceased(entity) ? (kanKnowsDeath(db, entity) ? 'deceased' : 'deceased, Kan does not know yet') : null,
      ].filter(Boolean);

      return `- ${ref}: ${entity.name}${others.length > 0 ? ` (${others.join(', ')})` : ''}${notes.length > 0 ? ` [${notes.join(', ')}]` : ''}`;
    }),
  ].join('\n');
}

/**
 * Details for the people this turn is about: Kan, the current scene cast,
 * and anyone named in the turn.
 */
function formatCharacterDetails(db: AppDatabase, turnText: string) {
  const refByEntity = refByEntityId(db);
  const cast = new Set((db.state.sceneCast ?? []).map((name) => name.toLowerCase()));
  const mentioned = (entity: EntityRecord) =>
    [entity.name, ...entity.aliases].some((name) => cast.has(name.toLowerCase())) ||
    mentionsEntity(turnText, entity);

  const characters = db.entities
    .filter((entity) => entity.type === 'character')
    .filter((entity) => entity.name.toLowerCase() === 'kan' || Boolean(entity.companion) || mentioned(entity))
    .slice(0, 10);

  if (characters.length === 0) {
    return '';
  }

  return [
    'CHARACTERS IN THIS TURN',
    ...characters.map((entity) => {
      const age = entityAge(db.state.inStoryDate, entity);
      const role = truncate(entity.role ?? '', 40);

      if (isDeceased(entity)) {
        return `- ${refByEntity.get(entity.id)}: ${entity.name}, DECEASED${kanKnowsDeath(db, entity) ? '' : ' (Kan does not know yet)'}`;
      }

      return `- ${refByEntity.get(entity.id)}: ${entity.name}${age !== undefined ? `, age ${age}` : ''}${role ? `, ${role}` : ''}${entity.companion ? ' [travelling with Kan]' : ''}; mood ${truncate(entity.mood ?? 'unknown', 60)}; appearance ${truncate(entity.appearance ?? 'unknown', 80)}`;
    }),
  ].join('\n');
}

function formatJutsu(db: AppDatabase) {
  const groups = groupJutsuByNature(db.jutsuRecords).slice(0, 5);

  if (groups.length === 0) {
    return 'KNOWN JUTSU\nNone.';
  }

  const signature = db.jutsuRecords
    .filter((record) => record.tags.includes('signature'))
    .map(
      (record) =>
        `  - ${record.name} (${record.user}): used ${record.timesUsed}×; effect ${truncate(record.effect, 120)}`
    );

  return [
    ...(signature.length > 0 ? ['SIGNATURE JUTSU', ...signature] : []),
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
  const deadLabel = new Map(
    db.entities
      .filter(isDeceased)
      .map((entity) => [entity.id, kanKnowsDeath(db, entity) ? ' [deceased]' : ' [deceased, Kan does not know yet]'])
  );
  const bonds = [...db.bonds]
    .filter((bond) => bond.isMajor || Math.abs(bond.affinity) >= 4 || bond.grudge)
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, 10);

  if (bonds.length === 0) {
    return 'BONDS\nNone yet.';
  }

  return [
    'BONDS',
    ...bonds.map(
      (bond) =>
        `- ${bond.characterName}${deadLabel.get(bond.entityId) ?? ''} (${bond.affinity}/10): ${truncate(bond.status ?? 'unknown', 50)}. ${truncate(bond.note, 80)}${bond.relationship ? ` [relationship: ${bond.relationship}${bond.attraction && bond.attraction !== 'none' ? `, attraction: ${bond.attraction}` : ''}]` : ''}${bond.grudge ? ` [grudge: ${grudgeStage(db, bond)}, ${truncate(bond.grudge.reason, 60)}]` : ''}`
    ),
  ].join('\n');
}

/**
 * Everyone who has died, always in the prompt, so no one comes back because
 * their death fact missed the 10-fact cut. Changes only when someone dies or
 * Kan learns of a death, so it sits in the cached part of the prompt.
 */
function formatTheDead(db: AppDatabase) {
  const dead = db.entities.filter(
    (entity) => entity.type === 'character' && entity.name.toLowerCase() !== 'kan' && isDeceased(entity)
  );

  if (dead.length === 0) {
    return '';
  }

  return [
    'THE DEAD',
    ...dead.map((entity) => {
      const cause = entity.deceased?.cause ? `: ${truncate(entity.deceased.cause, 60)}` : '';

      return `- ${entity.name}${cause}${kanKnowsDeath(db, entity) ? '' : ' (Kan does not know yet)'}`;
    }),
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
  if (isCombatPace(db.state.scenePace)) {
    return '';
  }

  const upcoming = upcomingWorldMilestones(db, 10);

  if (upcoming.length === 0) {
    return '';
  }

  const lines = [
    "RUMORS OF WHAT'S COMING (planned, NOT yet happened). The world is preparing; NPCs may mention preparations or rumors, never that it happened.",
  ];

  for (const item of upcoming) {
    lines.push(`- ${item.milestone.title}: about ${item.daysUntil} day(s) away (${item.milestone.era}).`);
  }

  return lines.join('\n');
}

function formatNewsBlock(db: AppDatabase) {
  // No news mid-fight; one piece per turn, or one catch-up report.
  return formatNewsOffer(newsOffer(db));
}

/** A catch-up report fills the turn; a letter waits for the next one. */
function turnLetterOffer(db: AppDatabase) {
  return newsOffer(db)?.mode === 'catch-up' ? null : letterOffer(db);
}

function formatLetterBlock(db: AppDatabase) {
  return formatLetterOffer(turnLetterOffer(db));
}

function formatCanonBlock(db: AppDatabase) {
  const active = activeCanonMilestones(db).slice(0, 2);
  const upcoming = upcomingCanonMilestones(db, PERSONAL_OFFERS_PER_TURN);
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
      `PERSONAL STORY BEAT — do not assume it happened (era ${beat.era}): ${truncate(beat.title, 70)} — ${truncate(beat.description, 130)}`
    );
    lines.push(
      '  This only occurs if Kan actually does it in the scene. Never state it has happened because time passed.'
    );
  }

  if (active.length > 0) {
    for (const milestone of active) {
      lines.push(
        `ACTIVE STORY BEAT: ${truncate(milestone.title, 70)}`
      );

      if (milestone.encounter) {
        lines.push(
          `  Encounter opportunity: ${milestone.encounter.who} — ${milestone.encounter.where}. ${truncate(milestone.encounter.context, 180)}`
        );
      }

      lines.push(
        '  If Kan\'s scene reaches this beat, play it out fully on the page.'
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

/**
 * Canon ids for the state call. The narrator never sees ids; the state model
 * decides from the prose whether a beat played out or news was delivered.
 */
function formatCanonTracking(db: AppDatabase) {
  const lines: string[] = [];

  for (const milestone of activeCanonMilestones(db).slice(0, 2)) {
    lines.push(
      `- ${milestone.id}: ${truncate(milestone.title, 70)} (active story beat). canon_engaged if Kan's scene took part in it this turn; canon_completed if it fully played out on the page; canon_passed if the chance clearly slipped by (Kan left, time moved on).`
    );
  }

  for (const beat of upcomingCanonMilestones(db, PERSONAL_OFFERS_PER_TURN)) {
    lines.push(
      `- ${beat.id}: ${truncate(beat.title, 70)} (personal beat). canon_engaged / canon_completed only if Kan actually did it in this turn — never because time passed.`
    );
  }

  lines.push(...newsTrackingLines(newsOffer(db)));

  if (lines.length === 0) {
    return '';
  }

  return ['CANON TRACKING', ...lines].join('\n');
}

function formatPressure(db: AppDatabase, recentText: string) {
  const grudge = formatGrudgeOffer(db, grudgeOffer(db));

  if (grudge) {
    return grudge;
  }

  return formatHunterOffer(hunterOffer(db)) || formatReturningCharacter(db, recentText);
}

function formatEnemyTracking(db: AppDatabase) {
  const refByEntity = refByEntityId(db);

  return [
    'REPUTATION & GRUDGES',
    ...reputationTrackingLines(db).map((line) => `- ${line}`),
    ...grudgeTrackingLines(grudgeOffer(db), (entity) => refByEntity.get(entity.id) ?? entity.name).map((line) => `- ${line}`),
  ].join('\n');
}

function formatLetterTracking(db: AppDatabase) {
  const refByEntity = refByEntityId(db);

  return [
    'LETTERS',
    ...letterTrackingLines(turnLetterOffer(db), (entity) => refByEntity.get(entity.id) ?? entity.name),
  ].join('\n');
}

function formatLoreProfile(db: AppDatabase, name: string) {
  const profile = loreProfileFor(name);

  if (!profile) {
    return '';
  }

  const era = eraNoteFor(name, db.state.inStoryDate.year);

  return `; heart: ${truncate(profile.canonDevotion, 90)} (${profile.romanceAccessibility})${endgameNote(db, name)}${era ? `; now: ${truncate(era, 80)}` : ''}`;
}


function truncate(value: string, maxLength: number) {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}…`;
}

function formatMemories(memories: EventRecord[]) {
  if (memories.length === 0) {
    return 'RELEVANT MEMORIES\nNone.';
  }

  return [
    'RELEVANT MEMORIES',
    ...memories.map((memory) => `- ${truncate(memory.summary, 400)}`),
  ].join('\n');
}

function tail(value: string, maxLength: number) {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return `…${value.slice(-maxLength).trimStart()}`;
}

/**
 * Keeps the opening and the ending of a long text and cuts the middle, at
 * word boundaries: roughly 40% from the start and 60% from the end.
 */
export function headAndTail(value: string, maxLength: number) {
  if (!value || value.length <= maxLength) {
    return value;
  }

  const headLength = Math.floor(maxLength * 0.4);
  const tailLength = maxLength - headLength;
  let head = value.slice(0, headLength);
  const headCut = head.lastIndexOf(' ');

  if (headCut > headLength * 0.6) {
    head = head.slice(0, headCut);
  }

  let end = value.slice(-tailLength);
  const tailCut = end.indexOf(' ');

  if (tailCut !== -1 && tailCut < tailLength * 0.4) {
    end = end.slice(tailCut + 1);
  }

  return `${head.trimEnd()} […] ${end.trimStart()}`;
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
        return `You (Kan): ${headAndTail(message.content, 500)}`;
      }

      const clean = stripNarrationJson(message.content);

      // The newest beat is shown nearly whole; older ones keep how they
      // opened and how they ended, so who arrived and what was set up isn't lost.
      return index === lastAssistantIndex
        ? `Narrator: ${tail(clean, 2200)}`
        : `Narrator: ${headAndTail(clean, 1400)}`;
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

function formatTimeLine(db: AppDatabase, audience: 'narrator' | 'state' = 'narrator') {
  const stalled = db.state.turnsWithoutTimeChange ?? 0;
  const nudge =
    audience === 'narrator' && stalled >= 2
      ? ' — the last few beats never said how long they took; say plainly how much time passes.'
      : '';

  const label = audience === 'state' ? 'TIME BEFORE THIS TURN' : 'TIME';

  return `${label}\n${formatDate(db.state.inStoryDate)}${nudge}`;
}

/**
 * What to show while the narrator is still streaming. The narrator writes
 * prose only, but if a model starts a code block or JSON object anyway, hide
 * everything from that point so it never flashes on screen.
 */
export function streamingPreview(partial: string): string {
  let cut = partial.length;
  const fence = partial.indexOf('```');

  if (fence !== -1) {
    cut = Math.min(cut, fence);
  }

  const json = /(?:^|\n)\s*\{\s*(?:"|$)/.exec(partial);

  if (json) {
    cut = Math.min(cut, json.index);
  }

  return partial.slice(0, cut).trimEnd();
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

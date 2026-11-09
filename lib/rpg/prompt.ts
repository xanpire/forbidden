import { advanceSeconds, dateSortValue, daysBetween, entityAge, formatClock, formatDate } from './calendar';
import { isPlayer, playerName } from './player';
import { paceMinimumSeconds } from './pacing';
import { CHECK_REASONS, ROMANCE_RULES, entityCanBeIntimate, formatIntimacyBlock, playerCanBeIntimate, formatOocNote, heartLine, stageLabel, STEER_LINES } from './intimacy';
import { characterRefs, mentionsEntity, refByEntityId } from './characterRefs';
import { reunionNotes } from './lives';
import { latestPov, povCandidates, povInstruction } from './povMemories';
import { consequenceTrackingLines, formatConsequenceOffer, turnConsequenceOffer } from './consequences';
import { locationKindOf } from './places';
import { HOME_TRACKING, formatHomeLine } from './home';
import { formatReturningCharacter } from './returning';
import { formatYearlyBlock, yearlyOffer, yearlyTrackingLines } from './yearly';
import { GRUDGE_RULES, grudgeStage } from './grudges';
import { estimateTokens } from '../openrouter';
import { formatWhoYouAre, formatWorldBlock } from './worldBlocks';
import { DEFAULT_SETTINGS } from './defaults';
import { isDeceased } from './deaths';
import { resolveEntity } from './entities';
import { alsoKnownAs, displayName, playerKnowsLine, playerKnowsName, labelOf, narratorName } from './names';
import { companionsOf, daysTogether, formatTogether } from './companions';
import { relevantFacts, retrieveMemories, triggeredLore } from './retrieval';
import { factRef, knowerNames } from './facts';
import { formatVarietyBlock } from './variety';
import { formatWeatherLine, formatWeatherTracking } from './weather';
import { formatPurseLine, priceGuideOf } from './money';
import { formatSexTracking, sexPartners } from './sexMode';
import { CONVERSATION_MODE_MINIMUM_SECONDS, formatSceneModeLine, formatSceneModeTracking, resolveTurnMode } from './sceneMode';
import type {
  AppDatabase,
  SteerChip,
  BondRecord,
  EntityRecord,
  EventRecord,
  FactRecord,
  OpenRouterMessage,
  RawLogEntry,
  SceneModeName,
} from './types';

const MIN_SCENE_MESSAGES = 4;
const STORY_CHAPTERS = 3;

export const NARRATION_SYSTEM = `You narrate an interactive story for adults, set in the real world today. The player is "you"; you play everyone and everything else.

THE PLAYER
- Never speak, act, think, feel or decide for the player. Show the world and how people react, then stop where the player would respond: on a line, a look, a move, a sound or an open moment. At most one reply in three ends on a direct question.
- When someone asks the player something, tells them to do something or makes an offer, the reply ends there. Never write their answer or what happens next. A plan said aloud ("let's get a drink after") has not happened yet.
- The player has only what CURRENT STATE lists: never hand them an item they don't have, and show it when one is used up or lost. Their money is the Purse; they can't spend more than they have. When money changes hands for them, say how much, at the PRICES given.

PEOPLE
- Everyone has a will, a life, moods, desires and limits of their own. They want things, refuse, lie, tease, change their minds, leave. Trust, friendship and love are earned and can be lost.
- People know only what they could know: what they saw, heard or were told in this story. A "narrator only" truth stays unsaid until the story reveals it.
- Anyone under WITH YOU is with the player in every scene and gets a real presence each turn, in their own voice, until the story shows them leave.
- The dead stay dead: anyone under THE DEAD appears only as a memory, a photo or a grave.
- New people get a distinct name, age, job, personality, voice and look. Most turns bring nobody new; empty places stay empty.

THE WORLD
- It is the present day: phones, texting, apps, the internet, cars, taxis, trains. No magic, powers or supernatural events, ever. Bodies are real: drink, tiredness, a hangover or a sprained ankle all show.
- Nothing is planned ahead. The story moves only from what the player does and what people would really do about it. People live their own lives off the page; a "since you last saw them" note says what changed, so let it show. SOMETHING COMES BACK is optional: use it only when it fits.
- The supplied state, people, bonds, facts, threads, summaries and memories are true. Open threads hold until the player changes them.

TIME
- The TIME block is the only clock. Never write a calendar date; say "the next morning", "later that night". Name an exact time only when the story fixes one, and then as TIME gives it.
- Say plainly how long things take ("a few minutes later", "an hour on", "by midnight", "after a full night's sleep"); the app reads the clock from your words. Be honest: a talk takes minutes, a nap under an hour, a night's sleep 8-9 hours, getting across town minutes to an hour.
- Numbers stay true once said: a price, a debt, a time, an address (see FIGURES ALREADY SAID). Nobody is in two places (see ELSEWHERE).

NAMES
- Call people only by the name the player knows (each card says it). Someone the player can't name gets the same short description every time ("the woman in the green coat") until they learn it: someone says it, or a badge, a screen or a message shows it. Never force an introduction.
- Characters use the names they know. If the player says a name they couldn't know, people react to it.

STYLE
- Second person, grounded and physical: bodies, places, light, weather (follow the WEATHER line all scene). Show feelings through what people do and say.
- 2-4 paragraphs of plain English unless SCENE MODE says otherwise: common words, short to medium sentences, few dashes or semicolons. Never reuse a description, gesture, metaphor or line from the recent scene. Every reply moves something.
- Play out talk and moments in full unless the player skips ahead; cover an uneventful trip in a line or two.
- In the player's input, "quoted text" is spoken and *asterisks* are actions.

SCENE MODES (the SCENE MODE line says which applies; with none, write as above)
- Conversation: mostly speech, like talking to them directly. Length follows the talk; between lines only short action lines in asterisks (*She looks away.*). Several people can speak, each in their own voice. The player's small moves and silences are part of the talk. Seconds to a minute or two pass.
- Talk is building: shorter and more spoken than usual.
- The conversation ends: a short transition in normal prose, then carry on.
- Sex: short, fully explicit turns of a few moments each, as the SCENE MODE line says; the partners act on their own desires and limits. Keep track of what everyone is wearing and where they are.
- Aftermath: one normal-length reply after the sex is over, then carry on.

${ROMANCE_RULES}

${GRUDGE_RULES}

OUTPUT
- Story prose only, straight into the scene: no JSON, lists, headings, labels, summaries or out-of-character notes. Speech in quotation marks; *asterisks* only for thoughts and the short action lines of a conversation.
- The app reads the state from your prose, so make changes clear: where the player goes, who is there, what is used, learned, promised or swapped (a number, a text), and when a scene ends.`;

const STATE_SYSTEM = `You are the state tracker for an interactive story set in the real world today; the player is "you". Read the narrator's latest turn and return one JSON object matching the schema. Never write story text.

- Report only what THIS turn shows changed: null when unchanged, [] when empty. Never invent anything or contradict the state below.
- Every text you write calls the player "you", never by name or "he"/"she" (facts, threads, world_description, bond notes, scene titles). Only ids use "player".

TIME: time.elapsed + time.unit is the in-story time this turn covered, read from the prose: a line of talk takes seconds, a conversation minutes, a nap under an hour, a night's sleep 8-9 hours, getting across town minutes to an hour. Count only what the prose shows happening; plans said aloud ("let's meet at eight") add nothing. time.clock_time stays null unless the prose names the time ("at noon", "just after 3"); it must fit TIME BEFORE THIS TURN plus time.elapsed. scene_pace: action (anything quick and physical: a scuffle, running, a rush), conversation, travel (getting from place to place), or downtime (rest, sleep, waiting).

PLACE: location, with location_kind, when the player moves. location_kind: structure (inside a building: a flat, a bar, an office, a shop), settlement (a street, a square, a market, a busy public place), road (a road, a bridge, a station, a car park), wilderness (a park, a beach, the countryside). Never put the player in characters_present. mood (1-3 words) and world_description (one sentence) only when changed. inventory_added / inventory_removed. money: every change to your own money on the page: amount negative when you pay, lose or give it away, positive when you are paid, given or find it; reason in a few words ("drinks at the bar"). Someone else paying for you changes nothing, and money only talked about has not moved. Use the amount the prose names; if none, estimate it from PRICES; never more than the Purse in CURRENT STATE. money_counted: your total, only when the prose states it exactly. Money is never an inventory item. weather: a few words only when the prose shows the weather change from WEATHER NOW; otherwise null.

PEOPLE: refer to every person by their id from KNOWN CHARACTERS (you are "player") in every field that takes a person. Match every name, nickname and description against KNOWN CHARACTERS first (a first name, a surname and "the bartender with the silver ring" can be the same id), including people the player has not met yet. new_characters is ONLY for someone missing from KNOWN CHARACTERS: is_new true, their fullest known name, age, role, personality, speech, appearance, gender, attracted_to (men, women, both, none, or unknown if not shown), minor (true for a one-scene character: a waiter, a cashier, a driver), and name_known (false for a stranger with no name yet: name is then a short description, like "the woman in the green coat"); elsewhere this turn, refer to them by that exact name. characters_present: only those physically in the scene at the end; [] if the player is alone. character_updates: visible mood changes; whereabouts when the story says where someone is going or waiting ("at work until six"); appearance is how they look RIGHT NOW (what they are wearing, wet, dressed up), kept turn to turn unless the prose changes it; lasting_appearance only for a lasting change (a new haircut, a tattoo). bonds have two sides. affinity_change (-10..10) and note: how THEY feel about you, moved only by what they could see or hear. your_change and your_note: how YOU feel about them; your unspoken thoughts move only this side. relationship is one label: stranger, acquaintance, friendly, close, old friend, family, teammate, partner (at work, never romance), mentor, student, rival, enemy, romantic interest, lover, rejected, ex; change it only when the relationship itself changes. attraction and romance_note only if changed. Only important people get bonds; minor people go in facts.

NAMES: you see everyone's real id; the notes say which name you (the player) know each by. Every text you write names people only as you knew them then, or describes them. names_learned: {character_id, name, part, how} only when a name is spoken or written within your hearing or reading this turn and you did not know it: part given, family, or full; how introduced (they said it), told (someone else said it), written (a message, a badge, a screen), or overheard. Otherwise [].

WITH YOU: people marked [with you] are with the player in every scene; always list them in characters_present. companions_joined: by id, someone who clearly comes along with the player this turn (they leave together, agree to come), with a short reason; companions_left: someone who truly goes their own way, with a short reason. Stepping out for a minute or a short errand is not leaving. Give them a bonds entry whenever what you go through together moves how they feel (affinity_change usually -3..3).

DEATHS: deaths lists, by id, anyone the prose makes certain is dead this turn (on the page, or someone tells the player). Never for someone unconscious, missing or only rumoured dead. The dead are never in characters_present or bonds. revived: ids of someone marked dead who turns out alive.

MEMORY: facts are what actually happened or is now true, never what someone merely said. Every fact has entity (who it is about; "player" for you), a type, and who_knows (ids, or group names like "her coworkers"). Types: death, injury (a sprained ankle, a cut), condition (a passing state: tired, drunk, soaked, a hangover), secret, knowledge (someone learned something), membership (joined or left a group, a job), possession, relationship, plan, figure (a number said in the story: a price, a debt, an address, a time, word for word), event (anything else). A boast, rumour or claim gets claimed_by (the speaker's id), or is left out. lasts: "until_rest" for a condition a night's sleep ends, "days" (with days) for an injury or plan with an expected length, "lasting" otherwise. When a fact replaces an ACTIVE FACT, list its ref in supersedes; refs that simply stopped being true go in facts_ended. threads are promises, debts, plans, mysteries or goals, with participants (ids besides you): "open" only for something no OPEN THREAD covers (otherwise "update" it under its exact title); "update" or "resolved" reuse the exact title. scene_ended is true only when the scene clearly concluded. scene_title (2-5 words, like "Rain at the bar") only when this turn starts a new scene or the Scene name no longer fits; otherwise null. chapter_title (3-6 words) only when this turn truly opens a new chapter: a big turn in the story or a long time skip; most turns are null.

LIVES: life_events: {character_id, event} for something in a person's own life away from you that this turn reveals (a promotion, a move, a new job, a breakup; they tell you, or a message says it); event in a few words, third person without their name ("got promoted to manager"); otherwise []. birthdays_learned: ids of people whose birthday you learn this turn; otherwise [].

GRUDGES: grudges, consequences and consequences_returned follow the rules under CONSEQUENCES & GRUDGES; otherwise [].

TURN: turn_kind, from the player's input and the reply together: exchange (back-and-forth talk, including small moves in place or a silence the other person reacts to), instruction (someone tells the player to do something that leads into action: "follow me", "wait here"), remark (a one-off line in passing), action (a move that changes the scene: leaving, going somewhere, someone new taking over), or travel. talking_with: ids of who the player is talking with (exchange, instruction, remark); otherwise [].

IMAGE: image_worthy is true only for visually striking moments, never pure dialogue.

SEX: sex follows the rules under SEX below.

INTIMACY: intimacy_stage_changed: {character_id, stage} only when the relationship with the player reaches a new step (none, interest, flirting, first kiss, lovers, established) or falls back; otherwise []. first: {character_id, what} for a first or a big moment between them this turn (a first kiss, a first night, "I love you"); otherwise []. preference_learned: {character_id, preference, about_player} when someone clearly learns what the player likes (about_player true) or the player learns what they like (false), in a few plain words; otherwise []. outfit_changed: {character_id, outfit, position} when someone's clothes or position change on the page ("player" for you); otherwise []. limit_crossed: true only if the reply writes something under the player's hard limits. age_rule_crossed: true only if the reply makes anyone under 18, anyone without a stated adult age, or anyone described as a child part of anything sexual. Both false otherwise.`;

const SUMMARY_SYSTEM = `You are a story summarizer for a long-running interactive novel.

Write a 100-150 word summary of the supplied scene.
- Second person, present tense: the player is "you" ("You follow her outside"). Everyone else is named only by the name you knew them by at the time, as the scene does; someone you could not name stays described ("the man in the grey coat").
- Concrete and specific.
- No meta-text, no commentary, no greeting.
- Mention the most important NPCs, your choices, and the consequences.

Reply in exactly this format, nothing else:
TITLE: a 2-6 word name for this stretch of story, no ending punctuation
MEMORY: one or two short sentences (under 40 words), second person, on what you will remember of it
SUMMARY: the 100-150 word summary`;

const ARC_SUMMARY_SYSTEM = `You are a story archivist for a long-running interactive novel.

Combine the supplied chapter summaries into one compact arc summary.
- 120-180 words.
- Second person, present tense: the player is "you". Everyone else is named only by the names you knew them by, as the summaries do.
- Keep cause and effect clear.
- Preserve names, dates, and major consequences.
- No meta-text.

Reply in exactly this format, nothing else:
TITLE: a 2-6 word name for the arc, no ending punctuation
SUMMARY: the arc summary`;

const TIME_SKIP_SYSTEM = `You are a time-skip narrator for a long-running interactive novel.

Write 100-150 words describing what happened meanwhile during the supplied time skip.
- Second person, present tense: the player is "you". Everyone else is named only by the names you know them by.
- Focus on your off-screen growth, NPC changes, and world movement.
- Respect the facts and bonds provided.
- No meta-text.

Reply in exactly this format, nothing else:
TITLE: a 2-6 word name for this stretch of time, no ending punctuation
SUMMARY: the 100-150 word summary`;

export function buildNarrationPrompt(
  db: AppDatabase,
  userMessage: string,
  options: { steer?: SteerChip; oocNote?: string } = {}
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
  // The people actually present, then anyone named: a label ("the masked
  // man") never matches a name in the text.
  const matchedEntityIds = new Set([
    ...companionsOf(db).map((entity) => entity.id),
    ...sceneCastIdsOf(db),
    ...db.entities
      .filter((entity) => mentionsEntity(entityText, entity))
      .map((entity) => entity.id),
  ]);
  const allFacts = relevantFacts(db, matchedEntityIds, entityText);
  const allLore = triggeredLore(db, entityText);
  // What the prompt budget cuts first (see the loop at the end): older
  // memories, then the less relevant facts and lore, and only then the
  // oldest lines of the recent scene.
  let facts = allFacts;
  let lore = allLore;
  const storySoFar = getStorySoFar(db);
  const shownSummaries = new Set(
    [storySoFar.arc, ...storySoFar.chapters].filter((text): text is string => Boolean(text))
  );
  // A memory saved from a summary that is already shown would only repeat it.
  let freshMemories = memories.filter(
    (memory) =>
      !shownSummaries.has(memory.summary) &&
      !(memory.summaryId && storySoFar.ids.includes(memory.summaryId))
  );
  const arcSummary = storySoFar.arc ?? storySoFar.chapters[storySoFar.chapters.length - 1] ?? null;
  // Conversation, fight, or normal narration, from the scene so far and the player's input.
  const sceneMode = resolveTurnMode(db, userMessage);
  // At most one outside pressure per turn: a grudge first, then something
  // coming back, then a familiar face.
  const pressure = formatPressure(db, entityText);

  // Ordered from never-changing to changing-every-turn, so the front of the
  // prompt is a stable prefix that providers can cache (cache reads cost a
  // fraction of fresh input).
  // 1. The rules: identical on every turn of every story.
  const rules = NARRATION_SYSTEM;
  // 2. The world and the player's character, as the player wrote them:
  //    change only when the player edits them.
  const written = [formatWorldBlock(db), formatWhoYouAre(db), formatIntimacyBlock(db)].join('\n\n');
  // 3. The long view: changes only when a summary lands, a thread opens or
  //    closes, or a bond moves.
  const slow = [
    formatStorySoFar(storySoFar),
    formatThreads(db),
    formatBonds(db),
    formatTheDead(db),
  ].filter(Boolean).join('\n\n');

  // 4. Everything that moves turn to turn.
  const buildDynamic = (messagesForScene: RawLogEntry[]) =>
    [
      formatState(db),
      formatCompanions(db),
      formatTimeLine(db, 'narrator', sceneMode.mode),
      formatWeatherLine(db),
      formatHomeLine(db),
      formatMatchedEntities(db, matchedEntityIds),
      formatFacts(db, facts),
      formatFigures(db),
      formatElsewhere(db),
      formatLore(lore),
      formatYearlyBlock(yearlyOffer(db)),
      formatMemories(db, freshMemories),
      formatRecentMessages(messagesForScene),
      formatLastBeat(messagesForScene),
      formatVarietyBlock(db),
      pressure,
      `CONTINUITY: continue directly from the last narrated beat. Never repeat a beat you already wrote and never contradict it. Location type: ${locationKindOf(db)}.`,
      formatSceneModeLine(db, sceneMode),
      options.steer ? STEER_LINES[options.steer] : '',
      formatOocNote(options.oocNote),
      `YOU DO OR SAY:\n${userMessage}`,
    ]
      .filter(Boolean)
      .join('\n\n');

  const assemble = (messagesForScene: RawLogEntry[]): OpenRouterMessage[] => {
    const ruleText = rules;
    const slowText = slow;

    return [
      {
        role: 'system',
        content: `${ruleText}\n\n${written}\n\n${slowText}`,
        parts: [
          { text: `${ruleText}\n\n`, cache: true },
          { text: `${written}\n\n`, cache: true },
          { text: slowText, cache: true },
        ],
      },
      { role: 'user', content: (buildDynamic(messagesForScene)) },
    ];
  };

  const budget = db.settings.promptTokenBudget ?? DEFAULT_SETTINGS.promptTokenBudget;
  let sceneMessages = recentMessages;
  let messages = assemble(sceneMessages);
  let estimated = estimateTokens(messages);

  // Prompt budget: cut the least important material first — recalled
  // memories, then the less relevant facts and lore — and the recent scene
  // last, oldest lines first.
  const cuts: (() => boolean)[] = [
    () => (freshMemories.length > 2 ? ((freshMemories = freshMemories.slice(0, 2)), true) : false),
    () => (facts.length > 6 ? ((facts = facts.slice(0, 6)), true) : false),
    () => (lore.length > 2 ? ((lore = lore.slice(0, 2)), true) : false),
    () => (freshMemories.length > 0 ? ((freshMemories = []), true) : false),
    () => (facts.length > 3 ? ((facts = facts.slice(0, 3)), true) : false),
  ];

  for (const cut of cuts) {
    if (estimated <= budget) break;
    if (cut()) {
      messages = assemble(sceneMessages);
      estimated = estimateTokens(messages);
    }
  }

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
    sceneMode,
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
    formatPrices(db),
    formatBonds(db),
    formatThreads(db),
  ].join('\n\n');

  const reply = [...db.rawLog].reverse().find((entry) => entry.role === 'assistant' && entry.content === assistantMessage);
  const dynamic = [
    // Facts move every turn, so they sit outside the cached part, with refs
    // the tracker can end or replace.
    formatFacts(db, stateFacts(db, `${userMessage}\n${assistantMessage}`), { refs: true }),
    formatState(db),
    formatCompanionIds(db),
    formatCharacterDetails(db, `${userMessage}\n${assistantMessage}`),
    formatTimeLine(db, 'state'),
    formatWeatherTracking(db),
    formatSceneModeTracking(null, reply?.sceneMode),
    formatIntimacyTracking(db),
    formatSexTracking(db, (entity) => refByEntityId(db).get(entity.id) ?? entity.name),
    `HOME\n${HOME_TRACKING}`,
    formatYearlyTracking(db),
    formatConsequenceTracking(db),
    previousBeat
      ? `PREVIOUS BEAT (context only — already recorded)\n${tail(stripNarrationJson(previousBeat.content), 500)}`
      : '',
    'THIS TURN',
    `You (${playerName(db)}): ${userMessage}`,
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

export function buildSceneSummaryPrompt(db: AppDatabase, messages: RawLogEntry[]) {
  const transcript = messages
    .map(
      (message) =>
        `${message.role === 'user' ? `You (${playerName(db)})` : 'Narrator'}: ${truncate(message.content, 1000)}`
    )
    .join('\n\n');

  const system = [
    SUMMARY_SYSTEM,
    formatState(db),
    formatBonds(db),
  ].join('\n\n');

  // The people it mattered to most also get their own side of it.
  const pov = povInstruction(povCandidates(db, messages));
  const intimate = messages.some((message) => message.intimate)
    ? db.content?.vagueRecaps === false
      ? 'Part of this is an intimate scene: summarise it in your own words like any other moment (who, what it meant, how it changed things); never copy its lines.\n\n'
      : 'Part of this is an intimate scene: give it one plain, non-explicit sentence (who, that it happened, how it changed things between them), never its details.\n\n'
    : '';
  const user = `${intimate}SCENE TRANSCRIPT:\n${transcript}\n\n${pov ? `${pov}\n\n` : ''}Write the summary now.`;
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
    formatFacts(db, db.facts.filter((fact) => fact.validTo === null).slice(0, 10)),
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
  return db.rawLog.filter((message) => message.kind === 'story').slice(-limit);
}

type StorySoFar = {
  arc: string | null;
  /** Newest chapter summaries, oldest first. */
  chapters: string[];
  /** Ids of the summaries shown. */
  ids: string[];
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

  return {
    arc: arc?.text ?? null,
    chapters: picked.map((summary) => summary.text),
    ids: [...(arc ? [arc.id] : []), ...picked.map((summary) => summary.id)],
  };
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

function formatState(db: AppDatabase) {
  const state = db.state;

  return [
    'CURRENT STATE',
    `Date: ${formatDate(state.inStoryDate)}`,
    `Location: ${truncate(state.location, 100)}`,
    `Your mood: ${truncate(state.mood, 60)}`,
    `World: ${truncate(state.worldDescription, 220)}`,
    `Inventory: ${truncate(state.inventory.slice(-10).join(', '), 240) || 'none'}`,
    formatPurseLine(db),
    `Chapter: ${state.chapter}${state.chapterTitle ? ` (${state.chapterTitle})` : ''}`,
    `Scene: ${truncate(state.scene, 140)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Who travels with the player, for the narrator: they are in every scene. Changes
 * only by the day count, so it sits right after the state block.
 */
function formatCompanions(db: AppDatabase) {
  const companions = companionsOf(db);

  if (companions.length === 0) {
    return '';
  }

  const bonds = new Map(db.bonds.map((bond) => [bond.entityId, bond]));

  return [
    'WITH YOU (at your side in every scene until the story shows them leave)',
    ...companions.map((entity) => {
      const bond = bonds.get(entity.id);
      const companion = entity.companion!;
      const days = daysTogether(db, entity);
      const together = days <= 0 ? 'joined today' : `together ${formatTogether(days)}`;
      const how = [companion.reason, companion.sinceLocation ? `from ${companion.sinceLocation}` : null]
        .filter(Boolean)
        .join(', ');
      const feeling = bond
        ? `; feels ${bond.affinity > 0 ? '+' : ''}${bond.affinity}/10 toward you${bond.relationship && bond.relationship !== 'stranger' ? ` (${bond.relationship})` : ''}${bond.note ? `: ${truncate(bond.note, 70)}` : ''}`
        : '';

      return `- ${narratorName(db, entity)}: ${together}${how ? ` (${truncate(how, 80)})` : ''}, ${companion.sharedScenes} scene${companion.sharedScenes === 1 ? '' : 's'} shared${feeling}`;
    }),
  ].join('\n');
}

/** The same, for the state tracker: ids it must keep in characters_present. */
function formatCompanionIds(db: AppDatabase) {
  const companions = companionsOf(db);
  const refByEntity = refByEntityId(db);

  return `WITH YOU: ${
    companions.length > 0
      ? companions.map((entity) => `${refByEntity.get(entity.id)} (${entity.name})`).join(', ')
      : 'nobody'
  }`;
}

/** The scene cast as entity ids. */
function sceneCastIdsOf(db: AppDatabase): string[] {
  return (db.state.sceneCast ?? [])
    .map((name) => resolveEntity(db, name)?.id)
    .filter((id): id is string => Boolean(id));
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
        !isPlayer(db, entity)
    )
    // Companions first, so a crowded scene never cuts them.
    .sort((a, b) => Number(Boolean(b.companion)) - Number(Boolean(a.companion)))
    .slice(0, 6);

  if (characters.length === 0) {
    return '';
  }

  // Someone the player meets again after a long time; how each remembers the player.
  const reunions = reunionNotes(db, characters);
  const remembers = (entity: EntityRecord) => {
    const pov = latestPov(db, entity.id);

    return pov ? `; remembers of you: "${truncate(pov, 120)}"` : '';
  };

  const known = (entity: EntityRecord) => {
    const other = playerKnowsName(entity) ? alsoKnownAs(db, entity)[0] : undefined;
    const card = playerKnowsName(entity) ? displayName(db, entity) : `${labelOf(db, entity)} [narrator only: ${entity.name}]`;

    return `${card}${other ? ` (also called ${other})` : ''}`;
  };
  const truth = (entity: EntityRecord) => `\n  ${playerKnowsLine(db, entity)}.`;

  return [
    'CHARACTERS IN SCENE',
    ...characters.map(
      (entity) =>
        `- ${known(entity)}${entity.role ? ` (${truncate(entity.role, 40)})` : ''}${isDeceased(entity) ? ` [DECEASED]` : ''}: personality ${truncate(entity.personality ?? 'unknown', 60)}; speech ${truncate(entity.speechStyle ?? 'unknown', 50)}; mood ${truncate(entity.mood ?? 'unknown', 60)}; appearance ${truncate(entity.appearance ?? 'unknown', 80)}${entity.currentLook ? `; right now: ${truncate(entity.currentLook, 90)}` : ''}${formatHeart(db, entity)}${remembers(entity)}${truth(entity)}${reunions.has(entity.id) ? `\n  ${reunions.get(entity.id)}` : ''}`
    ),
  ].join('\n');
}

/**
 * Everyone the state tracker can refer to, by ID. Stable from turn to turn
 * (it only changes when someone is added, merged or renamed), so it sits in
 * the cached part of the prompt.
 */
/**
 * People in the background: never met, and long dead before the story (no
 * date of death). They stay out of the roster
 * to keep it short; when a turn names them they are listed with their id
 * under CHARACTERS IN THIS TURN. Anyone who dies during the story stays.
 */
function inBackground(entity: EntityRecord) {
  const longDead = isDeceased(entity) && !entity.deceased?.date;

  return entity.met === false && !entity.companion && longDead;
}

function formatCharacterRoster(db: AppDatabase) {
  const refs = [...characterRefs(db)].filter(([, entity]) => !inBackground(entity));

  if (refs.length === 0) {
    return 'KNOWN CHARACTERS\nNone.';
  }

  return [
    'KNOWN CHARACTERS (id: name, other names) — refer to people by id; anyone listed here or under CHARACTERS IN THIS TURN already exists',
    ...refs.map(([ref, entity]) => {
      const others = entity.aliases.filter((alias) => alias.toLowerCase() !== entity.name.toLowerCase()).slice(0, 4);
      const notes = [
        isPlayer(db, entity) ? 'the player' : null,
        entity.met === false ? 'not met yet' : null,
        entity.companion && !isDeceased(entity) ? 'with you' : null,
        isDeceased(entity) ? 'deceased' : null,
      ].filter(Boolean);

      return `- ${ref}: ${entity.name}${others.length > 0 ? ` (${others.join(', ')})` : ''}${notes.length > 0 ? ` [${notes.join(', ')}]` : ''}`;
    }),
  ].join('\n');
}

/**
 * Details for the people this turn is about: the player, the current scene cast,
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
    .filter((entity) => isPlayer(db, entity) || Boolean(entity.companion) || mentioned(entity))
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
        return `- ${refByEntity.get(entity.id)}: ${entity.name}, DECEASED`;
      }

      const name = isPlayer(db, entity) ? '' : `; ${playerKnowsName(entity) ? `you know them as ${displayName(db, entity)}` : `you don't know their name (you see "${labelOf(db, entity)}")`}`;

      return `- ${refByEntity.get(entity.id)}: ${entity.name}${age !== undefined ? `, age ${age}` : ''}${role ? `, ${role}` : ''}${entity.companion ? ' [with you]' : ''}${entity.livesWithYou ? ' [lives with you]' : ''}${name}; mood ${truncate(entity.mood ?? 'unknown', 60)}; base look ${truncate(entity.appearance ?? 'unknown', 80)}${entity.currentLook ? `; right now: ${truncate(entity.currentLook, 80)}` : ''}`;
    }),
  ].join('\n');
}

/** The world's price scale, for the tracker (stable per save). */
function formatPrices(db: AppDatabase) {
  const guide = priceGuideOf(db);

  return guide ? (/^PRICES\b/i.test(guide) ? guide : `PRICES (${db.world.currency.name}): ${guide}`) : '';
}

function formatBonds(db: AppDatabase) {
  const deadLabel = new Map(
    db.entities
      .filter(isDeceased)
      .map((entity) => [entity.id, ' [deceased]'])
  );
  const people = new Map(db.entities.map((entity) => [entity.id, entity]));
  // The name the player knows them by, never the record's own name.
  const bondName = (bond: BondRecord) => {
    const entity = people.get(bond.entityId);

    return entity ? narratorName(db, entity) : bond.characterName;
  };
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
        `- ${bondName(bond)}${deadLabel.get(bond.entityId) ?? ''} (they feel ${bond.affinity}/10 toward you; you feel ${bond.yourFeelings?.affinity ?? bond.affinity}/10 toward them): ${truncate(bond.status ?? 'unknown', 50)}. ${truncate(bond.note, 80)}${bond.yourFeelings?.note ? ` You: ${truncate(bond.yourFeelings.note, 60)}` : ''}${bond.relationship ? ` [relationship: ${bond.relationship}${bond.attraction && bond.attraction !== 'none' ? `, attraction: ${bond.attraction}` : ''}]` : ''}${bond.grudge ? ` [grudge: ${grudgeStage(db, bond)}, ${truncate(bond.grudge.reason, 60)}]` : ''}`
    ),
  ].join('\n');
}

/**
 * Everyone who has died, always in the prompt, so no one comes back because
 * their death fact missed the 10-fact cut. Changes only when someone dies or
 * the player learns of a death, so it sits in the cached part of the prompt.
 */
function formatTheDead(db: AppDatabase) {
  const dead = db.entities.filter(
    (entity) => entity.type === 'character' && !isPlayer(db, entity) && isDeceased(entity)
  );

  if (dead.length === 0) {
    return '';
  }

  return [
    'THE DEAD',
    ...dead.map((entity) => {
      const cause = entity.deceased?.cause ? `: ${truncate(entity.deceased.cause, 60)}` : '';

      // Someone the player never met nor heard of has no label worth giving: the name stays the narrator's.
      const name =
        playerKnowsName(entity) || entity.met !== false ? narratorName(db, entity) : `${entity.name} (unknown to you)`;

      return `- ${name}${cause}`;
    }),
  ].join('\n');
}

function formatFacts(db: AppDatabase, facts: FactRecord[], options: { refs?: boolean } = {}) {
  const active = facts.filter((fact) => fact.validTo === null);

  if (active.length === 0) {
    return 'PERMANENT FACTS\nNone.';
  }

  return [
    options.refs ? 'ACTIVE FACTS (ref: fact) — end or replace by ref' : 'PERMANENT FACTS',
    ...active.map((fact) => {
      const knowers = knowerNames(db, fact);
      const claim =
        fact.confidence === 'claimed'
          ? ` [claimed by ${db.entities.find((entity) => entity.id === fact.claimedBy)?.name ?? 'someone'}]`
          : '';
      const temporary = fact.untilRest ? ' [until rest]' : fact.expiresAt ? ' [temporary]' : '';

      return `- ${options.refs ? `${factRef(fact)}: ` : ''}${truncate(fact.text, 100)}${claim}${temporary}${knowers.length > 0 ? ` (known by: ${truncate(knowers.join(', '), 40)})` : ''}`;
    }),
  ].join('\n');
}

/** Facts the state tracker sees: the ones about people in this turn first, then the newest. */
function stateFacts(db: AppDatabase, turnText: string) {
  const active = db.facts.filter((fact) => fact.validTo === null);
  const here = new Set(
    db.entities
      .filter((entity) => entity.type === 'character' && mentionsEntity(turnText, entity))
      .map((entity) => entity.id)
  );
  const about = active.filter((fact) => fact.subjectEntityId && here.has(fact.subjectEntityId));
  const newest = [...active].reverse();

  return uniqueById([...about, ...newest]).slice(0, 14);
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
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

/** Always-on lore gets more room. */
function loreLimit(entry: AppDatabase['loreEntries'][number]) {
  return entry.always ? 1400 : 600;
}

function formatLore(lore: AppDatabase['loreEntries']) {
  if (lore.length === 0) {
    return '';
  }

  return [
    'RELEVANT LORE',
    ...lore.map((entry) => `- ${truncate(entry.text, loreLimit(entry))}`),
  ].join('\n');
}

/** At most one outside pressure per turn: something coming back, else a familiar face. */
function formatPressure(db: AppDatabase, recentText: string) {
  return formatConsequenceOffer(db, turnConsequenceOffer(db)) || formatReturningCharacter(db, recentText);
}

function formatConsequenceTracking(db: AppDatabase) {
  return ['CONSEQUENCES & GRUDGES', ...consequenceTrackingLines(turnConsequenceOffer(db)).map((line) => `- ${line}`)].join('\n');
}

/** Today's birthday, for the state tracker (bond moves and birthdays_learned). */
function formatYearlyTracking(db: AppDatabase) {
  const refByEntity = refByEntityId(db);
  const lines = yearlyTrackingLines(yearlyOffer(db), (entity) => refByEntity.get(entity.id) ?? entity.name);

  return lines.length ? ['THE DAY', ...lines.map((line) => `- ${line}`)].join('\n') : '';
}

/** What the tracker needs for limit_crossed and age_rule_crossed. */
function formatIntimacyTracking(db: AppDatabase) {
  const refByEntity = refByEntityId(db);
  const hard = (db.content?.limits ?? []).filter((tag) => tag.kind !== 'soft').map((tag) => tag.label);
  const notAdults = db.entities
    .filter((entity) => entity.type === 'character' && !entity.tags.includes('player') && !isDeceased(entity))
    .filter((entity) => !entityCanBeIntimate(db, entity).ok)
    .filter((entity) => (db.state.sceneCast ?? []).some((name) => name === entity.name) || sexPartners(db).includes(entity.id))
    .map((entity) => `${refByEntity.get(entity.id) ?? entity.name} (${(() => { const check = entityCanBeIntimate(db, entity); return check.ok ? '' : CHECK_REASONS[check.reason]; })()})`);
  const lines = [
    hard.length ? `- The player's hard limits (limit_crossed if the reply writes any): ${hard.join(', ')}` : '',
    notAdults.length ? `- Never part of anything sexual (age_rule_crossed if the reply makes them so): ${notAdults.join(', ')}` : '',
    playerCanBeIntimate(db).ok ? '' : '- The player is not a stated adult: anything sexual involving them is age_rule_crossed.',
  ].filter(Boolean);
  return lines.length ? ['INTIMACY CHECKS', ...lines].join('\n') : '';
}

/** Whose heart is where, their desires when it matters, and what they've learned about the player. */
function formatHeart(db: AppDatabase, entity: EntityRecord) {
  const bond = db.bonds.find((item) => item.entityId === entity.id);
  const stage = bond?.intimacyStage ? stageLabel(db, bond.intimacyStage) : '';
  const close = (bond?.intimacyStage ?? 0) >= 2 || sexPartners(db).includes(entity.id);
  const parts = [
    heartLine(entity, Boolean(close)),
    stage ? `between you: ${stage}` : '',
    close && bond?.learnedPreferences?.length ? `they remember: ${bond.learnedPreferences.join('; ')}` : '',
    entity.scenePosition ? `where they are now: ${truncate(entity.scenePosition, 90)}` : '',
  ].filter(Boolean);
  return parts.length ? `; ${parts.join('; ')}` : '';
}

function truncate(value: string, maxLength: number) {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}…`;
}

function formatMemories(db: AppDatabase, memories: EventRecord[]) {
  if (memories.length === 0) {
    return 'RELEVANT MEMORIES\nNone.';
  }

  return [
    'RELEVANT MEMORIES',
    ...memories.map((memory) => {
      // A memory written from a chapter summary recalls the whole summary;
      // the Journal shows only its short description.
      const full = memory.summaryId
        ? db.summaries.find((summary) => summary.id === memory.summaryId)?.text
        : undefined;
      const text = full ?? memory.summary;
      return `- ${memory.title ? `${memory.title}: ` : ''}${truncate(text, 400)}`;
    }),
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
        return `You: ${headAndTail(message.content, 500)}`;
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

function formatTimeLine(db: AppDatabase, audience: 'narrator' | 'state' = 'narrator', mode?: SceneModeName) {
  const stalled = db.state.turnsWithoutTimeChange ?? 0;
  const nudge =
    audience === 'narrator' && stalled >= 2
      ? ' — the last few beats never said how long they took; say plainly how much time passes.'
      : '';

  const label = audience === 'state' ? 'TIME BEFORE THIS TURN' : 'TIME';

  if (audience === 'state') {
    return `${label}\n${formatDate(db.state.inStoryDate)}`;
  }

  // The exact time now and the earliest this reply can end, so any hour the
  // narrator names matches the clock.
  const pace = db.state.scenePace ?? 'conversation';
  const ends = advanceSeconds(
    db.state.inStoryDate,
    mode === 'conversation' ? CONVERSATION_MODE_MINIMUM_SECONDS : paceMinimumSeconds(pace)
  );

  return `${label}\n${formatDate(db.state.inStoryDate)} (exactly ${formatClock(db.state.inStoryDate)}; at this pace this reply ends no earlier than ${formatClock(ends)})${nudge}`;
}

/** Numbers the story has already stated (prices, debts, deadlines): they stay the same. */
function formatFigures(db: AppDatabase) {
  const figures = db.facts.filter((fact) => fact.validTo === null && fact.type === 'figure').slice(-8);

  if (figures.length === 0) {
    return '';
  }

  return ['FIGURES ALREADY SAID (keep them exactly; never restate a different number)', ...figures.map((fact) => `- ${truncate(fact.text, 110)}`)].join('\n');
}

/** Met people who are not here, and where they were last seen or said to be. */
function formatElsewhere(db: AppDatabase) {
  const cast = new Set((db.state.sceneCast ?? []).map((name) => name.toLowerCase()));
  const people = db.entities
    .filter(
      (entity) =>
        entity.type === 'character' &&
        !isPlayer(db, entity) &&
        entity.met !== false &&
        entity.tier !== 'minor' &&
        !isDeceased(entity) &&
        !entity.companion &&
        !cast.has(entity.name.toLowerCase()) &&
        entity.lastSeen &&
        (entity.whereabouts || entity.lastSeenAt) &&
        Math.abs(daysBetween(entity.lastSeen, db.state.inStoryDate)) <= 30
    )
    .sort((a, b) => dateSortValue(b.lastSeen!) - dateSortValue(a.lastSeen!))
    .slice(0, 6);

  if (people.length === 0) {
    return '';
  }

  return [
    'ELSEWHERE (not in this scene; each is where it says unless the story moves them, and never in two places)',
    ...people.map(
      (entity) =>
        `- ${narratorName(db, entity)}: ${entity.whereabouts ? truncate(entity.whereabouts, 70) : `last seen at ${truncate(entity.lastSeenAt ?? '', 50)}`}`
    ),
  ].join('\n');
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

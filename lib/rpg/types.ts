import type { ImageModelCaps } from '../openrouter';
export type ScenePace = 'combat' | 'chase' | 'conversation' | 'travel' | 'downtime';

/** How a turn played, tagged by the state tracker (see sceneMode.ts). */
export type SceneBeat = 'exchange' | 'instruction' | 'remark' | 'action' | 'travel' | 'combat';

/** How the narrator writes a turn: normal prose, conversation, or fight exchanges. */
export type SceneModeName = 'normal' | 'conversation' | 'fight' | 'intimate';

export type SceneModeState = {
  /** The mode the last turn was narrated in. */
  current: SceneModeName;
  /** Exchange beats in a row with the same person or group. */
  exchangeStreak: number;
  /** Who the player is talking with: entity ids (or lowercased names for people not on record). */
  partners: string[];
  lastBeat?: SceneBeat;
  /** The player's choice from the mode chip; cleared once it no longer applies. */
  override?: SceneModeName;
  /** An intimate scene is under way, with these people (entity ids). */
  intimateWith?: string[];
  /** The player chose "fade to black" for this scene. */
  fadeToBlack?: boolean;
};

/** The player's one-turn steer from the chips by the input. */
export type SteerChip = 'slower' | 'more' | 'skip-ahead' | 'fade-to-black';

export type CalendarDate = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
};

export type EntityType = 'character' | 'place' | 'faction' | 'object';

export type EventEntityRole = 'present' | 'mentioned' | 'participant';

/**
 * The fixed set of fact types (see FACT_TYPE_RULES in prompt.ts for what each
 * one is for): a tied scarf is not an injury, and "the clan is dead" is an
 * event, not a death fact about whoever did it.
 */
export type FactType =
  | 'death'
  | 'injury'
  | 'condition'
  | 'secret'
  | 'knowledge'
  | 'membership'
  | 'possession'
  | 'relationship'
  | 'plan'
  | 'figure'
  | 'event'
  | 'other';

export type ThreadType =
  | 'promise'
  | 'debt'
  | 'grudge'
  | 'mystery'
  | 'quest'
  | 'goal'
  | 'other';

export type SummaryLevel = 'chapter' | 'arc' | 'year';

export type LogKind = 'story' | 'summary' | 'extraction' | 'diff' | 'error';

export type LocationKind = 'settlement' | 'road' | 'wilderness' | 'structure';

export type GameState = {
  player: CharacterDefinition;
  mood: string;
  worldDescription: string;
  inventory: string[];
  location: string;
  locationKind?: LocationKind;
  inStoryDate: CalendarDate;
  turnsWithoutTimeChange?: number;
  /** A free line on where the world stands now. */
  worldPoint: string;
  /** The current chapter: a narrative unit, moved on only by real breaks (see applyChapterBreak). */
  chapter: number;
  /** The current chapter's title, from its break. */
  chapterTitle?: string;
  /** Where the current chapter began: its first turn (story turn number) and in-story date. */
  chapterStart?: { turn: number; date: CalendarDate };
  /** Finished chapters, oldest first. */
  chapters?: { chapter: number; title: string; from: CalendarDate; to: CalendarDate }[];
  scene: string;
  scenePace?: ScenePace;
  sceneCast?: string[];
  /** Conversation and fight mode (see sceneMode.ts). */
  sceneMode?: SceneModeState;
  /**
   * Counts scenes, so each story turn can be tied to one (RawLogEntry.sceneSeq)
   * and a memory never spans two. Moves on when a scene ends, the place
   * changes or a new scene title starts.
   */
  sceneSeq?: number;
  /** The last applied turn ended its scene: the next turn opens a new one. */
  sceneClosed?: boolean;
  /** Personal letters to and from the player (see letters.ts). */
  post?: PostState;
  /** What each faction has on the player (see reputation.ts). */
  reputation?: ReputationState;
  /** Birthdays, anniversaries and festivals (see yearly.ts). */
  yearly?: YearlyState;
  /** Deeds people talk about, and what they call the player (see renown.ts). */
  renown?: RenownState;
  /** Choices that could come back later (see consequences.ts). */
  consequences?: ConsequenceSeed[];
  /** The weather held for the current scene (see weather.ts). */
  weather?: WeatherLock;
  /** Every place the player has been, oldest first (see mapData.ts). */
  travelLog?: TravelStop[];
  /** Places the player stays: safehouses, rooms, hideouts, camps (see safehouses.ts). */
  safehouses?: SafehouseState;
  /** The money the player carries, and what moved it (see money.ts). */
  purse?: PurseState;
};

/** One change to the player's money (see money.ts). */
export type PurseEntry = {
  date: CalendarDate;
  /** In the world's currency, negative when the player paid, lost or gave it away. */
  change: number;
  reason: string;
  /** The story stated the player's total and the count was set to it. */
  counted?: boolean;
};

export type PurseState = {
  /** Money the player carries now, in the world's currency. */
  amount: number;
  /** The last 40 changes, oldest first. */
  history: PurseEntry[];
  /** An older save: the amount is the starting guess until the story states the total. */
  estimatedStart?: boolean;
};

export type SafehouseKind = 'own' | 'rented' | 'borrowed' | 'base' | 'camp';
export type SafehouseEnd = 'expired' | 'destroyed' | 'compromised' | 'withdrawn' | 'given-up' | 'left';

/** A place the player stays (see safehouses.ts). */
export type Safehouse = {
  id: string;
  /** A short name: "the flat above the bakery", "a room at the harbour inn". */
  name: string;
  kind: SafehouseKind;
  /** state.location when it became his. */
  place: string;
  region?: string;
  placeId?: string;
  since: CalendarDate;
  /** The last time the player was there. */
  lastVisit: CalendarDate;
  /** Nights (long rests) spent there. */
  nights: number;
  /** A rented room: paid until then. */
  until?: CalendarDate;
  /** A borrowed place: whose it is. */
  hostId?: string;
  hostName?: string;
  /** People (entity ids) and groups (a faction id, "the landlord") who know of it. */
  knownBy: string[];
  knownGroups: string[];
  stash: string[];
  upgrades: { name: string; since: CalendarDate }[];
  /** People living there (entity ids). */
  residents: string[];
  /** Found by someone the player is hiding from. */
  compromised?: { on: CalendarDate; by: string };
  /** Searched while the player was away; seen once he is back. */
  raided?: { on: CalendarDate; lost: string[]; seen: boolean };
  status: 'active' | 'ended';
  ended?: { on: CalendarDate; reason: SafehouseEnd; note?: string };
};

export type SafehouseState = {
  places: Safehouse[];
  /** The one the player is at now. */
  current?: string;
};

export type WeatherCondition =
  | 'clear'
  | 'cloudy'
  | 'drizzle'
  | 'rain'
  | 'downpour'
  | 'storm'
  | 'fog'
  | 'snow'
  | 'blizzard'
  | 'sleet'
  | 'wind'
  | 'sandstorm'
  | 'heat'
  | 'humid';

/**
 * The weather a scene is played in, held so it stays the same through the
 * scene: the world's own weather for the region, or what the story changed
 * it to (a storm rolling in, the fog lifting).
 */
export type WeatherLock = {
  /** A geography region id, or 'unknown'. */
  region: string;
  condition: WeatherCondition;
  /** The story's own words for it, when the story set it. */
  text?: string;
  since: CalendarDate;
  sceneSeq?: number;
  source: 'world' | 'story';
};

/** One stop on the player's road (see mapData.ts). */
export type TravelStop = {
  /** state.location as the story gave it. */
  place: string;
  /** A geography region id, when the place names one or the player has not left the last one. */
  region?: string;
  /** The map place it matches (a village, a shrine, a ruin). */
  placeId?: string;
  date: CalendarDate;
};

/** What the yearly calendar remembers (see yearly.ts). */
export type YearlyState = {
  /** Entity ids whose birthday you learned in the story (beyond the people you are close to). */
  knownBirthdays: string[];
  /** Yearly offers already made: key → the in-story year it was last offered. */
  offered: Record<string, number>;
};

/** A faction id from `db.world.factions`. */
export type ReputationFaction = string;

/** What one faction has on the player (see reputation.ts). */
export type FactionStanding = {
  /** 0-100: how badly they want the player, before cooling since lastDeedOn. */
  heat: number;
  /** -100..100: how they regard the player. */
  standing?: number;
  /** When they put the player on their wanted list (factions with bounties). Never removed. */
  listedOn?: CalendarDate;
  /** Their last new reason to want him; cooling counts from here. */
  lastDeedOn?: CalendarDate;
  lastReason?: string;
  /** True once the player has seen or been told what they wrote about them. */
  known: boolean;
};

export type ReputationState = {
  factions: Record<string, FactionStanding>;
  /** The last few changes, newest last. */
  recent: { faction: ReputationFaction; change: number; reason?: string; date: CalendarDate }[];
};

/** Someone's grudge against the player, kept on their bond (see grudges.ts). */
export type Grudge = {
  since: CalendarDate;
  reason: string;
  /** 0-100, before the stewing since updatedOn. */
  heat: number;
  updatedOn: CalendarDate;
  lastStrike?: CalendarDate;
  strikes: number;
};

/**
 * One personal letter. `to-player` letters come from someone the player is close to
 * (a reply to his own letter, or unprompted); `from-player` letters are the ones
 * he sends, which take days to arrive and move the recipient's bond.
 */
export type Letter = {
  id: string;
  direction: 'to-player' | 'from-player';
  entityId: string;
  name: string;
  sentOn: CalendarDate;
  arrivesOn: CalendarDate;
  /** What the letter says, in a few words (the player's own letters). */
  gist?: string;
  /**
   * The letter itself, kept for the archive: the player's own words (only spelling
   * and punctuation tidied), or the words the narrator gave the writer.
   */
  text?: string;
  /**
   * travelling: on its way; delivered: it reached its reader; lost: it never
   * arrived (see lostReason); unsent: a letter to the dead, kept, never sent.
   */
  status: 'travelling' | 'delivered' | 'lost' | 'unsent';
  /** Why a lost letter never arrived. */
  lostReason?: string;
  /** A to-player letter answering one of the player's. */
  replyTo?: string;
  deliveredOn?: CalendarDate;
  /** How it travels; sets its speed and how safe it is (see letters.ts). */
  carrier?: LetterCarrierKind;
  /** Written in a cipher. */
  coded?: boolean;
  /** Where the reader was thought to be when it set out (to notice they moved on). */
  toRegion?: string;
  /** Someone read it on the way (see letters.ts); the player does not know until it comes back to them. */
  interceptedBy?: Interceptor;
  /** A birthday letter. */
  occasion?: 'birthday';
};

/** How a letter travels: one of the world's carriers (free text), or 'hand' (delivered in person). */
export type LetterCarrierKind = string;

/** The faction id that read a letter on the way. */
export type Interceptor = string;

export type PostState = {
  letters: Letter[];
  /** When a letter last reached the player. */
  lastLetterIn?: CalendarDate;
};

/** A deed people saw, which travels as talk and shapes what they call the player (see renown.ts). */
export type Deed = {
  id: string;
  date: CalendarDate;
  text: string;
  /** Whose people saw it, when a faction did. */
  faction?: ReputationFaction;
  /** Where it happened (geography.ts region). */
  region?: string;
  /** How much it moved the world's view of the player (the reputation change, or a few points). */
  weight: number;
};

/** Who calls the player by a name of their own: a faction id, or 'common' for ordinary people. */
export type Audience = string;

export type Epithet = {
  name: string;
  since: CalendarDate;
  /** The theme it grew from (renown.ts), or 'story' when the story named the player. */
  theme: string;
  /** The player has heard themselves called this. */
  known: boolean;
  /** Names it had before, oldest first. */
  history?: { name: string; since: CalendarDate }[];
};

export type RenownState = {
  deeds: Deed[];
  epithets: Record<string, Epithet>;
};

/**
 * A choice that could come back later (see consequences.ts): who was
 * involved, who saw it, what they would want, and roughly when and where it
 * could return. It returns only if that is realistic, and only as an offer.
 */
export type ConsequenceSeed = {
  id: string;
  kind: ConsequenceKind;
  createdOn: CalendarDate;
  /** The person it comes back through, when the save knows them. */
  entityId?: string;
  /** Who it is, in words: a name, or "the bandit you spared at the ford". */
  who: string;
  /** What the player did. */
  what: string;
  /** What they would want now. */
  want?: string;
  /** Ids of anyone else who saw it. */
  witnesses: string[];
  /** A faction it could reach. */
  faction?: ReputationFaction;
  /** Where it happened (geography.ts region). */
  region?: string;
  /** Not before this date. */
  after: CalendarDate;
  /** It fades if it has not come back by this date. */
  before: CalendarDate;
  status: 'waiting' | 'returned' | 'faded';
  /** The letter it came from (an interception). */
  letterId?: string;
  /** The safehouse someone found out about (kind found). */
  safehouseId?: string;
  /** When it was last offered to the narrator. */
  offeredOn?: CalendarDate;
  resolvedOn?: CalendarDate;
};

export type ConsequenceKind =
  | 'spared'
  | 'lie'
  | 'helped'
  | 'witness'
  | 'betrayal'
  | 'humiliated'
  | 'promise'
  | 'debt'
  | 'intercepted'
  | 'found';

export type RawLogEntry = {
  id: string;
  turn: number;
  kind: LogKind;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  chapter: number;
  scene: string;
  inStoryDate: CalendarDate;
  createdAt: number;
  image?: string | null;
  /** In-story seconds this reply moved the clock (assistant story turns). */
  elapsedSeconds?: number;
  /** True once the player corrected elapsedSeconds by hand. */
  timeCorrected?: boolean;
  /** Which scene this turn belongs to (GameState.sceneSeq when it was applied). */
  sceneSeq?: number;
  /** Who was in the scene this turn (entity ids, from the scene cast, the player excluded). */
  sceneCastIds?: string[];
  /** How the scene image on this entry was made, so drift can be traced and it can be redone. */
  imageMeta?: SceneImageMeta;
  /** The scene mode this reply was narrated in (assistant story turns). */
  sceneMode?: SceneModeName;
  /** The state tracker judged this beat visually striking (image_worthy). */
  imageWorthy?: boolean;
  /** Quick moves offered under a fight reply (written by the state tracker). */
  fightOptions?: string[];
  /** Part of an intimate scene (its memory is summarised, never kept verbatim). */
  intimate?: boolean;
};

export type SceneImageMeta = {
  prompt: string;
  /** The short "who did what to whom" line the image followed. */
  action: string;
  /** The scrapbook caption, written in second person with the action line. */
  caption?: string;
  /** The director's camera line (shot, angle, lens, composition, light). */
  shot?: string;
  /** The shot type read from `shot`, for the variety tracker. */
  shotType?: string;
  /** A retouch: the player's tweak, and the stored image it was made from. */
  tweak?: string;
  previous?: string;
  /** The swapped-roles check: true when it found the roles reversed or extra people. */
  mightBeOff?: boolean;
  /** The references sent, in order: their kind, whose they are, and the stored image when there is one. */
  references: { kind: string; name?: string; ref?: string }[];
  model: string;
  createdAt: number;
};

export type EntityRecord = {
  id: string;
  name: string;
  type: EntityType;
  aliases: string[];
  birthday?: { month: number; day: number };
  /** True when nobody wrote a birthday and the app chose one (see yearly.ts). */
  birthdayInvented?: boolean;
  birthYear?: number;
  age?: number;
  role?: string;
  personality?: string;
  speechStyle?: string;
  status?: string;
  notes?: string;
  mood?: string;
  /**
   * Their base appearance: the lasting look, changed
   * only by real lasting changes like aging, scars or new clothing.
   */
  appearance?: string;
  /**
   * How they look right now: what they are wearing, wet, bloodied, dressed up. Cleared when the scene changes or after rest, unless renewed.
   */
  currentLook?: string;
  /** The scene (GameState.sceneSeq) currentLook was last set in. */
  currentLookSeq?: number;
  /** Where the story last said they are or are going, when not with the player. */
  whereabouts?: string;
  lastSeen?: CalendarDate;
  /** Where the player last saw this person (state.location at the time). */
  lastSeenAt?: string;
  /**
   * Set once this person has died in the story (see deaths.ts). `known` is
   * whether the player has seen it or been told.
   */
  deceased?: {
    date?: CalendarDate;
    cause?: string;
  };
  /** male, female, or unknown when the story hasn't said. */
  gender?: Gender;
  /**
   * Their own desires and boundaries, and whether their heart could open to
   * the player (intimacy.ts). Written by the player, or learned in play.
   */
  intimacy?: IntimacyProfile;
  /** A real, identifiable person (a celebrity, a historical figure): never in an intimate scene. */
  realPerson?: boolean;
  /** Where they are and how they're placed in the scene right now (kept by the tracker). */
  scenePosition?: string;
  /**
   * false for people written into the world whom you have not met
   * yet: they are known to the state tracker but stay off the bonds list.
   * Missing means met (older saves, and everyone the story introduced).
   */
  met?: boolean;
  /** How their name splits (see names.ts); worked out from the name when missing. */
  nameParts?: NameParts;
  /**
   * More than one identity (a persona, a claimed name, the true one), with
   * who in the world knows each (names.ts).
   */
  /**
   * What the player knows of their name. Missing means he knows it (older saves, and
   * anyone the story introduced by name). `{}` means nothing yet: he sees
   * only their label.
   */
  known?: NameKnowledge;
  /** The story has not given them a name yet: `name` is only their label. */
  unnamed?: true;
  /**
   * "minor": a one-scene character (a bounty target, a shopkeeper). No bond
   * card and no portrait unless they come back in a second scene, which
   * makes them an ordinary character.
   */
  tier?: 'minor';
  /**
   * Set while this person travels with the player (see companions.ts): they are in
   * every scene until the story shows them leave, and the scenes they share
   * move their bond.
   */
  companion?: Companion;
  /** Small events in their own life while the player was elsewhere (see lives.ts). */
  lifeEvents?: LifeEvent[];
  /** Set when the player meets them again after a long time apart (see lives.ts). */
  reunion?: Reunion;
  tags: string[];
};

/**
 * Something that happened in someone's own life away from the player: a promotion,
 * an injury, a move, a new team. `world` events are made by the engine as
 * time passes; `story` ones were stated on the page. `known` once the player has
 * learned of it (he met them again, or a letter told him).
 */
export type LifeEvent = {
  date: CalendarDate;
  text: string;
  kind: LifeEventKind;
  source: 'world' | 'story';
  known?: boolean;
};

export type LifeEventKind =
  | 'mission'
  | 'injury'
  | 'posting'
  | 'team'
  | 'loss'
  | 'skill'
  | 'promotion'
  | 'move'
  | 'work'
  | 'family'
  | 'romance'
  | 'growth'
  | 'other';

/** The player met them again after REUNION_DAYS apart: when, and when he had last seen them. */
export type Reunion = {
  on: CalendarDate;
  lastSeen: CalendarDate;
  lastSeenAt?: string;
  /** The scene it happened in (GameState.sceneSeq). */
  seq?: number;
};

export type Gender = 'male' | 'female' | 'unknown';

export type NameParts = { given?: string; family?: string; full?: string };

export type NamePart = 'given' | 'family' | 'full';

export type NameHow = 'introduced' | 'told' | 'written' | 'overheard' | 'start';

export type NameKnowledge = {
  /** A short description for someone the player cannot name yet ("the red-haired girl"). */
  label?: string;
  given?: boolean;
  family?: boolean;
  history?: { name: string; part: NamePart; how: NameHow; date: CalendarDate }[];
};

export type Companion = {
  /** When they started travelling with the player. */
  since: CalendarDate;
  /** Where they joined (state.location at the time). */
  sinceLocation?: string;
  /** Why, in a few words ("hired as your driver"). */
  reason?: string;
  /** Scenes that ended with them at the player's side. */
  sharedScenes: number;
  /** Shared-time progress toward the next bond step (see companions.ts). */
  bondPoints: number;
};

export type EventRecord = {
  id: string;
  chapter: number;
  scene: string;
  inStoryDate: CalendarDate;
  summary: string;
  /** Short name shown in the Journal; `summary` is then the description. */
  title?: string;
  /** The chapter summary this memory was written from. */
  summaryId?: string;
  importance: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  pinned: boolean;
  sourceLogId: string | null;
  /**
   * For a scene-end memory (sourceLogId null): the story turn it was made
   * on, so the chapter summary built from that turn takes it in.
   */
  turnLogId?: string;
  /**
   * The same memory as people who were there remember it, limited to what
   * they could see or hear, in their own voice (see povMemories.ts). Only
   * major characters, and only when the scene mattered to them.
   */
  povs?: { entityId: string; text: string }[];
  createdAt: number;
};

export type EventEntityRecord = {
  eventId: string;
  entityId: string;
  role: EventEntityRole;
};

/** One side of a bond: -10..10 and a short note. */
export type BondSide = { affinity: number; note: string };

export type BondRecord = {
  id: string;
  entityId: string;
  characterName: string;
  /** How they feel about the player: always the same as theirFeelings.affinity. */
  affinity: number;
  status: string;
  lastKeyEventId: string | null;
  /** Always the same as theirFeelings.note. */
  note: string;
  /** How they feel about you, from what they could see or hear. */
  theirFeelings?: BondSide;
  /** How you feel about them; your inner thoughts move only this side. */
  yourFeelings?: BondSide;
  isMajor: boolean;
  relationship?: RelationshipStage;
  attraction?: Attraction;
  romanceNote?: string;
  /** Set while this person holds a grudge against the player (grudges.ts). */
  grudge?: Grudge;
  /** Index into the story's intimacy ladder (intimacy.ts); 0 = none. */
  intimacyStage?: number;
  /** Scene beats shown on the page toward the next stage. */
  stageBeats?: number;
  /** Firsts and big moments, in the player's story. */
  firsts?: IntimacyFirst[];
  /** What they have learned the player likes (and the player about them), in plain words. */
  learnedPreferences?: string[];
  updatedInStoryDate: CalendarDate;
};

export type IntimacyFirst = { what: string; when: CalendarDate; where: string };

/** A person's own desires and boundaries (see intimacy.ts). */
export type IntimacyProfile = {
  /** Free text. */
  orientation: string;
  interestedInPlayer: 'yes' | 'could-grow' | 'no' | 'taken';
  /** What they like, in the player's words. */
  desires: string[];
  /** What they won't do; the narrator respects these. Empty = none written. */
  boundaries: string[];
  /** shy, bold, teasing, dominant, tender… */
  style?: string;
  experience?: string;
  /** Who or what their heart belongs to, when it is taken. */
  devotion?: string;
};

/** A tag the player writes in their content profile. */
export type ContentTag = {
  label: string;
  note?: string;
  /** Interests only. */
  weight?: 'love' | 'like' | 'okay';
  /** Limits only: hard = never happens and is never mentioned; soft = only off-page. */
  kind?: 'hard' | 'soft';
};

/** How this story plays intimacy (per save; see intimacy.ts). Scenes are always fully explicit. */
export type ContentProfile = {
  pacing: 'slow-burn' | 'natural' | 'fast';
  interests: ContentTag[];
  limits: ContentTag[];
  narratorVoice?: string;
  /** Keep intimate details vague in recaps and summaries (default on). */
  vagueRecaps: boolean;
  /** The intimacy ladder's labels for this story. */
  stageLabels?: string[];
};

export type FactRecord = {
  id: string;
  /** Who the fact is about. Always set for new facts (the player when nobody else). */
  subjectEntityId: string | null;
  type: FactType;
  text: string;
  /** Entity ids of the people who know it. */
  whoKnows: string[];
  /** Groups who know it, as tags ("police", "the-family"). */
  whoKnowsGroups?: string[];
  validFrom: CalendarDate;
  /** Set when the fact ended: replaced, contradicted, expired. Only facts without it are active. */
  validTo: CalendarDate | null;
  /** confirmed: it happened. claimed: someone said so (see claimedBy). */
  confidence: 'confirmed' | 'rumored' | 'claimed';
  /** Entity id of whoever claimed it, for confidence "claimed". */
  claimedBy?: string;
  /** A temporary condition ends on its own at this date unless renewed. */
  expiresAt?: CalendarDate;
  /** A temporary condition that ends at the next sleep or long rest. */
  untilRest?: boolean;
  /** The fact this one replaced, if any. */
  supersedes?: string;
  sourceEventId: string | null;
  /** The story turn (assistant log entry) that recorded it. */
  sourceLogId?: string;
};

export type ThreadRecord = {
  id: string;
  type: ThreadType;
  title: string;
  description: string;
  status: 'open' | 'resolved';
  openedAt: CalendarDate;
  resolvedAt: CalendarDate | null;
  importance: 1 | 2 | 3 | 4 | 5;
  participants: string[];
  /** The same people as entity ids. */
  participantIds?: string[];
  sourceEventId: string | null;
  /** The story turn (assistant log entry) that opened it. */
  sourceLogId?: string;
};

export type LoreRecord = {
  id: string;
  keywords: string[];
  priority: number;
  text: string;
  enabled: boolean;
  /** Narrator-only guidance; never shown in the Journal. */
  hidden?: boolean;
  /** Always in the narrator's prompt, whatever the turn mentions. */
  always?: boolean;
};

export type SummaryRecord = {
  id: string;
  level: SummaryLevel;
  range: {
    fromEventId: string;
    toEventId: string;
    from: CalendarDate;
    to: CalendarDate;
  };
  text: string;
  /** Short title written by the summary model. */
  title?: string;
  /** The chapter number this summary closes (chapter summaries). */
  chapter?: number;
  tokenCount: number;
  eventIds: string[];
  createdAt: number;
  /** Story log entries this summary was written from (chapter summaries). */
  sourceLogIds?: string[];
  /** Chapter summaries this summary rolled up (arc and year summaries). */
  sourceSummaryIds?: string[];
};

/**
 * A background memory step that runs after a turn's state is already saved.
 * Jobs live in the save so a failed or interrupted step survives a reload
 * and can be retried from the story screen.
 */
export type MemoryJobKind = 'state' | 'timeSkip' | 'scene' | 'arc' | 'year';

export type MemoryJob = {
  id: string;
  kind: MemoryJobKind;
  /** queued = waiting or running, failed = needs a retry. */
  status: 'queued' | 'failed';
  /** The narrator reply this job belongs to. */
  turnLogId: string;
  /** state: the player's action for that turn. */
  userMessage?: string;
  /** scene: the story messages to summarize. */
  logIds?: string[];
  /** arc / year: the chapter summaries to roll up. */
  summaryIds?: string[];
  /** timeSkip: the jump being summarized. */
  fromDate?: CalendarDate;
  toDate?: CalendarDate;
  attempts: number;
  error?: string;
  createdAt: number;
};

export type MemoryIndex = {
  eventsByTag: Record<string, string[]>;
  eventsByEntity: Record<string, string[]>;
  eventsByDate: Record<string, string[]>;
  factsBySubject: Record<string, string[]>;
  threadsByStatus: Record<string, string[]>;
  loreByKeyword: Record<string, string[]>;
};

export type Settings = {
  narrationModel: string;
  summaryModel: string;
  extractionModel: string;
  imageModel: string;
  /** What the image model accepts, looked up when it is picked. */
  imageModelCaps?: ImageModelCaps | null;
  contextMessages: number;
  retrievalLimit: number;
  autoSummarizeThreshold: number;
  temperature: number;
  maxTokens: number;
  /** Upper bound on the narrator prompt, in estimated tokens. */
  promptTokenBudget: number;
  /** Frames each scene image (the "director"); empty = the narrator model. */
  imageDirectorModel?: string;
  /** Explicit pictures: which provider, and the model on each. */
  explicitProvider?: 'runware' | 'wiro';
  runwareModel?: string;
  wiroModel?: string;
  /** Check each scene image for swapped roles and retry once (default on). */
  imageCheck?: boolean;
  /** Paint two takes and let you keep one (default off). */
  imageTwoTakes?: boolean;
};

export type { RelationshipStage } from './intimacy';
import type { RelationshipStage } from './intimacy';

export type Attraction = 'none' | 'warm' | 'strong';

export type AppDatabase = {
  schemaVersion: 1;
  meta: {
    slotId: string;
    slotName: string;
    createdAt: number;
    updatedAt: number;
  };
  settings: Settings;
  rawLog: RawLogEntry[];
  entities: EntityRecord[];
  events: EventRecord[];
  eventEntities: EventEntityRecord[];
  bonds: BondRecord[];
  facts: FactRecord[];
  threads: ThreadRecord[];
  loreEntries: LoreRecord[];
  summaries: SummaryRecord[];
  /** The world the player wrote (see world.ts). */
  world: WorldDefinition;
  /** How this story plays intimacy (see intimacy.ts). */
  content: ContentProfile;
  state: GameState;
  indices: MemoryIndex;
  snapshots: TurnSnapshot[];
  portraits?: PortraitRecord[];
  /** Portraits of the people in your bonds (see characterPortrait.ts). */
  characterPortraits?: CharacterPortraitRecord[];
  /** Face references you chose for people, kept only on this device. */
  characterFaces?: CharacterFaceRecord[];
  memoryJobs?: MemoryJob[];
  /** Explicit pictures of intimate scenes (explicitImages.ts). Behind the PIN lock; left out of exports by default. */
  explicitImages?: ExplicitImageRecord[];
  /** In-app reference sheets for explicit pictures, made from written appearance only. */
  explicitRefs?: { entityId: string; image: string; createdAt: number }[];
};

export type ExplicitImageRecord = {
  id: string;
  image: string;
  shot: import('./explicitImages').ExplicitShot;
  provider: 'runware' | 'wiro';
  model: string;
  cost?: number;
  inStoryDate: CalendarDate;
  createdAt: number;
};

/** What the player wore, in words (their sheet's outfit). */
export type PortraitOutfit = string;

export type PortraitExpression = 'calm' | 'grim' | 'angry' | 'tired' | 'warm' | 'sad';

export type PortraitSetting = 'village' | 'wilds' | 'road' | 'indoors';

export type PortraitSignature = {
  age: number;
  outfit: PortraitOutfit;
  expression: PortraitExpression;
  setting: PortraitSetting;
};

export type CharacterPortraitSignature = {
  /** null when their age is unknown. */
  age: number | null;
  expression: PortraitExpression;
  appearance: string;
};

export type CharacterPortraitRecord = {
  id: string;
  entityId: string;
  /** Image reference (img:...) or a data URI on platforms without IndexedDB. */
  image: string;
  signature: CharacterPortraitSignature;
  /** Whether their face reference was sent with this painting. */
  usedFace: boolean;
  inStoryDate: CalendarDate;
  createdAt: number;
};

export type CharacterFaceRecord = {
  entityId: string;
  /** Image reference (img:...) or a data URI. */
  image: string;
  addedAt: number;
};

export type PortraitRecord = {
  id: string;
  /** Image reference (img:...) or a data URI on platforms without IndexedDB. */
  image: string;
  signature: PortraitSignature;
  inStoryDate: CalendarDate;
  location: string;
  createdAt: number;
};

export type TurnSnapshot = {
  id: string;
  turn: number;
  database: AppDatabase;
  createdAt: number;
};

export type SceneInfo = {
  ended: boolean;
  summary?: string;
  tags?: string[];
  entities?: string[];
  importance?: 1 | 2 | 3 | 4 | 5;
  imageWorthy?: boolean;
};

export type TurnDiff = {
  state?: {
    mood?: string;
    worldDescription?: string;
    inventoryAdded?: string[];
    inventoryRemoved?: string[];
    location?: string;
    locationKind?: LocationKind;
    inStoryDate?: CalendarDate;
    elapsedSeconds?: number;
    clockTime?: { hour: number; minute: number };
    scenePace?: ScenePace;
    worldPoint?: string;
    chapter?: number;
    scene?: string;
    sceneCast?: string[];
  };
  /** The state model judged this beat visually striking (queues a scene summary). */
  imageWorthy?: boolean;
  /** How this turn played, and who the player was talking with (ids from the tracker). */
  beat?: { kind: SceneBeat; with: string[] };
  /** Moves the player could make next while a fight goes on. */
  fightOptions?: string[];
  /** This turn opens a new chapter with this title (the state model's chapter_title). */
  chapterTitle?: string;
  /**
   * People the prose seems to show, read by the app when the state reply was
   * unreadable. Only a suggestion: it never marks anyone met or seen, and
   * never changes the scene cast (only characters_present does).
   */
  suggestedCast?: string[];
  entities?: {
    /** Set when the state tracker referred to a known character by ID. */
    entityId?: string;
    /** From new_characters with is_new: true — the only entries allowed to create someone. */
    isNew?: boolean;
    name: string;
    age?: number;
    role?: string;
    personality?: string;
    speechStyle?: string;
    mood?: string;
    /** New characters: their base look. Updates: their look right now (currentLook). */
    appearance?: string;
    /** A real lasting change to their base look (aging, a scar, new clothes for good). */
    lastingAppearance?: string;
    /** Where the story says they are or are going. */
    whereabouts?: string;
    gender?: Gender;
    /** A one-scene character (see EntityRecord.tier). */
    minor?: boolean;
    /** Who they are drawn to: men, women, both, none, or unknown. */
    attractedTo?: 'men' | 'women' | 'both' | 'none' | 'unknown';
    /** A short description of how they look to the player, for someone they cannot name. */
    label?: string;
    /** false: the player doesn't know their name yet (a stranger: `name` is then only their label). */
    nameKnown?: boolean;
  }[];
  bonds?: {
    /** Set when the state tracker referred to a known character by ID. */
    entityId?: string;
    character: string;
    /** Change to how they feel about you (their side). */
    affinityDelta?: number;
    status?: string;
    /** Their side's note. */
    note?: string;
    /** Change to how you feel about them (your side). */
    yourDelta?: number;
    yourNote?: string;
    isMajor?: boolean;
    relationship?: string;
    attraction?: string;
    romanceNote?: string;
  }[];
  facts?: {
    action: 'add' | 'end';
    type?: FactType;
    text: string;
    subject?: string;
    whoKnows?: string[];
    validFrom?: CalendarDate;
    /** Refs ("f-…") or ids of active facts this one replaces. */
    supersedes?: string[];
    /** How long it holds: lasting (default), until the next rest, or a number of days. */
    lasts?: 'lasting' | 'until_rest' | 'days';
    days?: number;
    /** Who said it, when it is only a claim. */
    claimedBy?: string;
  }[];
  /** Refs or ids of active facts that stopped being true this turn. */
  factsEnded?: string[];
  threads?: {
    action: 'open' | 'update' | 'resolve';
    title: string;
    description?: string;
    type?: ThreadType;
    participants?: string[];
  }[];
  /** People who died this turn, or whose death the player saw or was told of. */
  deaths?: { entityId?: string; name: string; cause?: string }[];
  /** People who turned out to be alive after all (a wrong report, a faked death). */
  revived?: { entityId?: string; name: string }[];
  /** People who start travelling with the player this turn. */
  companionsJoined?: { entityId?: string; name: string; reason?: string }[];
  /** Companions who part ways with the player this turn. */
  companionsLeft?: { entityId?: string; name: string; reason?: string }[];
  /** Letters or messages the player sent this turn to someone far away (or wrote to the dead). */
  lettersSent?: {
    entityId?: string;
    name: string;
    gist?: string;
    /** The letter as the player wrote it, only spelling and punctuation tidied. */
    text?: string;
    carrier?: LetterCarrierKind;
    coded?: boolean;
  }[];
  /** People whose letter reached the player on the page this turn, with its words. */
  lettersReceived?: { entityId?: string; name: string; text?: string }[];
  /** Things in someone's own life away from the player that this turn revealed. */
  lifeEvents?: { entityId?: string; name: string; text: string }[];
  /** Intimacy (intimacy.ts): what the page showed between the player and someone. */
  intimacyStages?: { entityId?: string; name: string; stage: string }[];
  firsts?: { entityId?: string; name: string; what: string }[];
  preferencesLearned?: { entityId?: string; name: string; preference: string; aboutPlayer: boolean }[];
  outfits?: { entityId?: string; name: string; outfit?: string; position?: string }[];
  /** true: an intimate scene starts or goes on; false: it ends; undefined: no change. */
  intimateScene?: boolean;
  /** The player's hard limit was written. The reply is thrown away. */
  limitCrossed?: boolean;
  /** Someone under 18, of no stated age, or described as a child was sexualised. The reply is thrown away. */
  ageRuleCrossed?: boolean;
  /** A name the story called the player by this turn, and whose name it is. */
  epithet?: { audience: Audience; name: string };
  /** Choices this turn that could plausibly come back later. */
  consequences?: {
    kind: ConsequenceKind;
    entityId?: string;
    who: string;
    what: string;
    want?: string;
    witnesses?: string[];
    faction?: ReputationFaction;
    when?: 'weeks' | 'months' | 'years';
  }[];
  /** Ids of offered consequences that came back on the page this turn. */
  consequencesReturned?: string[];
  /** The weather as the page changed it this turn, in a few words. */
  weather?: string;
  /** A place the player settles in or sleeps at, and what changed there (see safehouses.ts). */
  safehouse?: SafehouseDiff;
  /** Changes to the player's own money this turn, in the world's currency (negative when they pay). */
  money?: { amount: number; reason: string }[];
  /** The total the player has, when the prose states it. */
  moneyCounted?: number;
  /** What a faction now has on the player. */
  reputation?: { faction: ReputationFaction; change: number; reason?: string }[];
  /** People whose birthday the player learned this turn (they said it, someone told them). */
  birthdaysLearned?: { entityId?: string; name: string }[];
  /** Names the player heard, read or recognised this turn (names.ts). */
  namesLearned?: { entityId?: string; character: string; name: string; part: NamePart; how: NameHow }[];
  /** Factions whose wanted entry on the player they saw or were told of this turn. */
  bountySeen?: string[];
  /** Grudges started, acted on, settled or forgiven this turn. */
  grudges?: {
    entityId?: string;
    name: string;
    event: 'wronged' | 'struck' | 'settled' | 'forgiven';
    reason?: string;
  }[];
  scene?: SceneInfo;
};

export type SafehouseDiff = {
  /** A listed safehouse id; none means where the player is now. */
  id?: string;
  name?: string;
  kind?: SafehouseKind;
  paidNights?: number;
  host?: string;
  stored?: string[];
  taken?: string[];
  upgrade?: string;
  shownTo?: string[];
  residentsJoined?: string[];
  residentsLeft?: string[];
  ended?: Exclude<SafehouseEnd, 'left'>;
};

export type OpenRouterMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /**
   * Optional split of `content` into blocks, in order. A block marked `cache`
   * ends a cacheable prefix: providers that need explicit breakpoints
   * (Anthropic, Gemini) get a cache_control marker after it. `content` is
   * always the blocks joined, so token estimates and the debug view stay the same.
   */
  parts?: { text: string; cache?: boolean }[];
  /** Images sent with a user message (data URIs), for vision calls. */
  images?: string[];
};

// ---------------------------------------------------------------------------
// The player's world and character (sandbox). Written by the player; the
// build step (seed.ts) only turns them into save records.
// ---------------------------------------------------------------------------

/** A region's weather pattern. `none` = indoors, underground, a station: no weather. */
export type ClimateType =
  | 'temperate'
  | 'continental'
  | 'desert'
  | 'tundra'
  | 'tropical'
  | 'monsoon'
  | 'rainy'
  | 'coastal'
  | 'mountain'
  | 'none';

/** A group in the world: a company, a family, a gang, a police force, a crew, a church. */
export type FactionDef = {
  id: string;
  name: string;
  description: string;
  /** Regions it holds (see reputation.ts: "in their territory"). */
  territoryRegionIds?: string[];
  /** Keeps a wanted list and pays bounties in the world's currency. */
  hasBounties?: boolean;
  /** How its people send word: "courier", "phone", "text message"… */
  carriers?: string[];
  /** 0–1: how likely it reads letters that cross its land. */
  readsMail?: number;
};

export type RegionDef = {
  id: string;
  name: string;
  description: string;
  climate: ClimateType;
  /** Regions next to this one and how many days' travel apart. */
  neighbours: { id: string; days: number }[];
};

export type PlaceDef = {
  id: string;
  name: string;
  regionId: string;
  kind: LocationKind;
  description: string;
};

export type FestivalDef = {
  id: string;
  name: string;
  /** Words matched against the player's location; empty = everywhere. */
  where: string[];
  month: number;
  day: number;
  /** How many days it runs (default 1). */
  days?: number;
  note: string;
};

/** The world the player wrote. */
export type WorldDefinition = {
  id: string;
  name: string;
  /** One-paragraph pitch, in the player's words. */
  premise: string;
  genre: string;
  tone: string;
  /**
   * When the story is set. Grounded in reality: no magic or powers; a past
   * setting uses that period's real technology and customs, a future one
   * plausible technology only.
   */
  era: WorldEra;
  currency: { name: string; symbol?: string; priceGuide: string };
  calendar: { yearLabel: string; start: CalendarDate; monthNames?: string[] };
  factions: FactionDef[];
  regions: RegionDef[];
  places: PlaceDef[];
  /** The player's own lore entries. */
  lore: LoreRecord[];
  festivals: FestivalDef[];
  /** How letters and messages travel, fitting the era: "courier", "post", "phone", "text message"… */
  letterCarriers: string[];
  /** Image style opener, e.g. "cinematic photo, 35mm film". */
  artStyle: string;
  /** The player's own extra rules for the narrator. */
  narratorNotes?: string;
};

export type WorldEra = {
  when: 'past' | 'present' | 'future';
  /** Free text: "Paris, 1920s", "today", "2140, a crowded Earth". */
  period: string;
  /** What exists and what doesn't, in plain words. */
  techNotes?: string;
};

/**
 * The character the player plays (`db.state.player`). The first fields are
 * what the player wrote; the last ones the game keeps up to date in play.
 */
export type CharacterDefinition = {
  name: string;
  aliases: string[];
  /** Age at the start of the story. */
  age: number;
  birthday?: { month: number; day: number };
  gender: string;
  appearance: string;
  outfit: string;
  personality: string;
  speechStyle: string;
  /** The player's own text, kept verbatim. */
  backstory: string;
  role: string;
  /** Plain text: job, training, languages, what they're good at. No ability records. */
  skills?: string;
  inventory: string[];
  money: number;
  secrets: string[];
  goals: string[];
  /** `img:` references the player uploaded. */
  faceImage?: string;
  outfitImage?: string;

  /** In-story year of birth, worked out from `age` and the opening date. */
  birthYear?: number;
};

/** Someone the player adds before the story starts. */
export type StartingPerson = {
  name: string;
  aliases?: string[];
  age?: number;
  birthday?: { month: number; day: number };
  gender: string;
  role: string;
  appearance: string;
  personality: string;
  speechStyle: string;
  relationship: string;
  yourFeelings: { affinity: number; note: string };
  theirFeelings: { affinity: number; note: string };
  attraction?: number;
  /** Optional: their own desires and boundaries. An age of 18+ is required when set. */
  intimacy?: IntimacyProfile;
  /** A real, identifiable person: never in an intimate scene. */
  realPerson?: boolean;
  alive: boolean;
  knownName: boolean;
  /** Has the player met them before the story? Default true. */
  met?: boolean;
  secrets?: string[];
  whereabouts?: string;
};

/** Something the player marked as true at the start ("things that are true"). */
export type StartingTruth = {
  text: string;
  /** Who it is about, by name; empty = the player. */
  about?: string;
  /** Who knows it, by name; "you" = the player. Empty = only the player. */
  knownBy?: string[];
  type?: FactType;
};

/** Everything the player wrote that a new save is built from (see seed.ts). */
export type SeedInput = {
  world: WorldDefinition;
  character: CharacterDefinition;
  people: StartingPerson[];
  opening: OpeningScene;
  truths?: StartingTruth[];
  content?: ContentProfile;
};

export type OpeningScene = {
  location: string;
  placeId?: string;
  date: CalendarDate;
  situation: string;
  castNames: string[];
  threads?: string[];
};

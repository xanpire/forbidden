import type { ImageModelCaps } from '../openrouter';
export type ScenePace = 'combat' | 'chase' | 'conversation' | 'travel' | 'downtime';

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
 * one is for): a tied headband is not an injury, and "the clan is dead" is an
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

export type PlayerSheet = {
  name: string;
  lineage: string[];
  birthday: { month: number; day: number };
  birthYear: number;
  rank: string;
  role: string;
  team: string[];
  sensei: string;
  personality: string[];
  secretNotes: string[];
  /** Kan's chakra natures: innate ones, and those taken with Thousand Souls. */
  natures?: NatureRecord[];
  /** Dōjutsu and other abilities, each at its current stage. */
  abilities?: AbilityRecord[];
};

export type NatureRecord = {
  /** Fire, Water, Wind, Earth, Lightning, Wood, Ice, Lava… */
  nature: string;
  source: 'innate' | 'thousand-souls';
  /** Whose chakra it came from (Thousand Souls). */
  from?: string;
  acquiredOn: CalendarDate;
};

export type AbilityRecord = {
  /** "Sharingan", "Mangekyō Sharingan", "Susanoo"… */
  name: string;
  /** "1 tomoe", "2 tomoe", "3 tomoe", "awakened", "ribcage", "full body"… */
  stage: string;
  acquiredOn: CalendarDate;
  /** When it reached its current stage. */
  stageOn: CalendarDate;
  /** Every stage it has had, oldest first. */
  history?: { stage: string; date: CalendarDate }[];
};

export type LocationKind = 'settlement' | 'road' | 'wilderness' | 'structure';

export type GameState = {
  player: PlayerSheet;
  mood: string;
  worldDescription: string;
  jutsu: string[];
  inventory: string[];
  location: string;
  locationKind?: LocationKind;
  inStoryDate: CalendarDate;
  turnsWithoutTimeChange?: number;
  canonPoint: string;
  canonProgress?: CanonProgress;
  chapter: number;
  scene: string;
  scenePace?: ScenePace;
  sceneCast?: string[];
  /**
   * Counts scenes, so each story turn can be tied to one (RawLogEntry.sceneSeq)
   * and a memory never spans two. Moves on when a scene ends, the place
   * changes or a new scene title starts.
   */
  sceneSeq?: number;
  /** The last applied turn ended its scene: the next turn opens a new one. */
  sceneClosed?: boolean;
  /** Personal letters to and from Kan (see letters.ts). */
  post?: PostState;
  /** Bingo books and Akatsuki standing (see reputation.ts). */
  reputation?: ReputationState;
};

export type VillageFaction = 'leaf' | 'sand' | 'mist' | 'cloud' | 'stone';
export type ReputationFaction = VillageFaction | 'akatsuki';

/** What one great village has on Kan (see reputation.ts). */
export type BingoEntry = {
  /** 0-100: how badly they want him, before cooling since lastDeedOn. */
  heat: number;
  /** When they wrote him into their bingo book. An entry is never removed. */
  listedOn?: CalendarDate;
  /** Their last new reason to want him; cooling counts from here. */
  lastDeedOn?: CalendarDate;
  lastReason?: string;
  /** True once Kan has seen or been told what they wrote about him. */
  known: boolean;
};

export type ReputationState = {
  villages: Partial<Record<VillageFaction, BingoEntry>>;
  /** -100..100: how the Akatsuki regard him. */
  akatsuki?: { standing: number; lastReason?: string; updatedOn?: CalendarDate };
  /** The last few changes, newest last. */
  recent: { faction: ReputationFaction; change: number; reason?: string; date: CalendarDate }[];
};

/** Someone's grudge against Kan, kept on their bond (see grudges.ts). */
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
 * One personal letter. `to-kan` letters come from someone Kan is close to
 * (a reply to his own letter, or unprompted); `from-kan` letters are the ones
 * he sends, which take days to arrive and move the recipient's bond.
 */
export type Letter = {
  id: string;
  direction: 'to-kan' | 'from-kan';
  entityId: string;
  name: string;
  sentOn: CalendarDate;
  arrivesOn: CalendarDate;
  /** What the letter says, in a few words (Kan's own letters). */
  gist?: string;
  /** travelling: on its way; delivered: it reached its reader; lost: the reader was dead. */
  status: 'travelling' | 'delivered' | 'lost';
  /** A to-kan letter answering one of Kan's. */
  replyTo?: string;
  deliveredOn?: CalendarDate;
};

export type PostState = {
  letters: Letter[];
  /** When a letter last reached Kan. */
  lastLetterIn?: CalendarDate;
};

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
  /** Who was in the scene this turn (entity ids, from the scene cast, Kan excluded). */
  sceneCastIds?: string[];
};

export type EntityRecord = {
  id: string;
  name: string;
  type: EntityType;
  aliases: string[];
  birthday?: { month: number; day: number };
  birthYear?: number;
  age?: number;
  role?: string;
  personality?: string;
  speechStyle?: string;
  status?: string;
  notes?: string;
  mood?: string;
  appearance?: string;
  lastSeen?: CalendarDate;
  /** Where Kan last saw this person (state.location at the time). */
  lastSeenAt?: string;
  /**
   * Set once this person has died in the story (see deaths.ts). `known` is
   * whether Kan has seen it or been told; a canon death also becomes known
   * when the news of `canonEventId` reaches him.
   */
  deceased?: {
    date?: CalendarDate;
    cause?: string;
    known?: boolean;
    canonEventId?: string;
  };
  romanceAccessibility?: 'winnable' | 'lore-locked';
  canonDevotion?: string;
  orientation?: string;
  /**
   * false for canon cast members loaded at the start whom you have not met
   * yet: they are known to the state tracker but stay off the bonds list.
   * Missing means met (older saves, and everyone the story introduced).
   */
  met?: boolean;
  /**
   * Spoiler names (Obito for the masked man, Nagato for Pain). Kept apart
   * from `aliases`, so they are never matched in story text, never shown and
   * never sent to a model. Once revealed (see `revealHiddenAliases`), a name
   * moves into `aliases`.
   */
  hiddenAliases?: HiddenAlias[];
  /**
   * Set while this person travels with Kan (see companions.ts): they are in
   * every scene until the story shows them leave, and the scenes they share
   * move their bond.
   */
  companion?: Companion;
  tags: string[];
};

export type HiddenAlias = {
  name: string;
  /** Canon milestone whose news (or engagement) reveals this name to Kan. */
  revealedBy?: string;
};

export type Companion = {
  /** When they started travelling with Kan. */
  since: CalendarDate;
  /** Where they joined (state.location at the time). */
  sinceLocation?: string;
  /** Why, in a few words ("assigned as your Akatsuki partner"). */
  reason?: string;
  /** Scenes that ended with them at Kan's side. */
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
  createdAt: number;
};

export type JutsuRecord = {
  id: string;
  name: string;
  user: string;
  chakraNature: string;
  effect: string;
  visual: string;
  firstSeen: CalendarDate;
  lastSeen: CalendarDate;
  timesUsed: number;
  description: string;
  tags: string[];
};

export type EventEntityRecord = {
  eventId: string;
  entityId: string;
  role: EventEntityRole;
};

export type BondRecord = {
  id: string;
  entityId: string;
  characterName: string;
  affinity: number;
  status: string;
  lastKeyEventId: string | null;
  note: string;
  isMajor: boolean;
  relationship?: RelationshipStage;
  attraction?: Attraction;
  romanceNote?: string;
  /** Set while this person holds a grudge against Kan (grudges.ts). */
  grudge?: Grudge;
  updatedInStoryDate: CalendarDate;
};

export type FactRecord = {
  id: string;
  /** Who the fact is about. Always set for new facts (Kan when nobody else). */
  subjectEntityId: string | null;
  type: FactType;
  text: string;
  /** Entity ids of the people who know it. */
  whoKnows: string[];
  /** Groups who know it, as tags ("hidden-leaf-leadership", "anbu-command"). */
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
  /** Always in the narrator's prompt, whatever the turn mentions (geography, say). */
  always?: boolean;
  /** Only once this holds (see loreActive). */
  activeAfter?: LoreCondition;
  /** Only until this holds. */
  activeUntil?: LoreCondition;
};

/**
 * Something the story reaches. Every field given must hold.
 * - milestone: a canon milestone Kan completed or took part in
 * - thread / threadStatus: a thread (by title) with that status (default resolved)
 * - fact: an active fact containing this text
 * - flag: a state flag the app works out (see LORE_FLAGS in lore.ts)
 */
export type LoreCondition = {
  milestone?: string;
  thread?: string;
  threadStatus?: 'open' | 'resolved';
  fact?: string;
  flag?: LoreFlag;
};

export type LoreFlag = 'hasSharingan' | 'hasMangekyo' | 'knowsIzumiDead' | 'headbandScratched' | 'joinedAkatsuki';

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
  canonProgress: boolean;
  /** Upper bound on the narrator prompt, in estimated tokens. */
  promptTokenBudget: number;
};

export type CanonProgress = {
  version?: number;
  baselineDate?: CalendarDate;
  baselineTurn?: number;
  completed: string[];
  active: string[];
  engaged: string[];
  expired?: string[];
  heard?: Record<string, { from: string; date: CalendarDate }>;
  /** True when the last advance was held back because Kan was mid-fight. */
  heldForCombat?: boolean;
};

export type RelationshipStage =
  | 'stranger'
  | 'friendly'
  | 'close'
  | 'romantic interest'
  | 'partner'
  | 'rejected'
  /** Was with Kan once; it ended. */
  | 'ex';

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
  jutsuRecords: JutsuRecord[];
  events: EventRecord[];
  eventEntities: EventEntityRecord[];
  bonds: BondRecord[];
  facts: FactRecord[];
  threads: ThreadRecord[];
  loreEntries: LoreRecord[];
  summaries: SummaryRecord[];
  state: GameState;
  indices: MemoryIndex;
  snapshots: TurnSnapshot[];
  portraits?: PortraitRecord[];
  /** Portraits of the people in your bonds (see characterPortrait.ts). */
  characterPortraits?: CharacterPortraitRecord[];
  /** Face references you chose for people, kept only on this device. */
  characterFaces?: CharacterFaceRecord[];
  memoryJobs?: MemoryJob[];
};

export type PortraitOutfit = 'black' | 'akatsuki';

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
    jutsuAdded?: string[];
    jutsuRemoved?: string[];
    inventoryAdded?: string[];
    inventoryRemoved?: string[];
    location?: string;
    locationKind?: LocationKind;
    inStoryDate?: CalendarDate;
    elapsedSeconds?: number;
    clockTime?: { hour: number; minute: number };
    scenePace?: ScenePace;
    canonPoint?: string;
    chapter?: number;
    scene?: string;
    sceneCast?: string[];
  };
  /** The state model judged this beat visually striking (queues a scene summary). */
  imageWorthy?: boolean;
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
    appearance?: string;
  }[];
  jutsuUsed?: {
    name: string;
    user: string;
    chakraNature?: string;
    effect?: string;
    visual?: string;
    description?: string;
  }[];
  bonds?: {
    /** Set when the state tracker referred to a known character by ID. */
    entityId?: string;
    character: string;
    affinityDelta?: number;
    status?: string;
    note?: string;
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
  /** People who died this turn, or whose death Kan saw or was told of. */
  deaths?: { entityId?: string; name: string; cause?: string }[];
  /** People genuinely brought back to life (never Edo Tensei). */
  revived?: { entityId?: string; name: string }[];
  /** People who start travelling with Kan this turn. */
  companionsJoined?: { entityId?: string; name: string; reason?: string }[];
  /** Companions who part ways with Kan this turn. */
  companionsLeft?: { entityId?: string; name: string; reason?: string }[];
  canonCompleted?: string[];
  canonEngaged?: string[];
  canonPassed?: string[];
  newsRelayed?: { id: string; from?: string }[];
  /** Letters or messages Kan sent this turn to someone far away. */
  lettersSent?: { entityId?: string; name: string; gist?: string }[];
  /** People whose letter reached Kan on the page this turn. */
  lettersReceived?: { entityId?: string; name: string }[];
  /** What a village or the Akatsuki now has on Kan. */
  reputation?: { faction: ReputationFaction; change: number; reason?: string }[];
  /** Villages whose bingo-book entry on Kan he saw or was told of this turn. */
  bountySeen?: VillageFaction[];
  /** Grudges started, acted on, settled or forgiven this turn. */
  grudges?: {
    entityId?: string;
    name: string;
    event: 'wronged' | 'struck' | 'settled' | 'forgiven';
    reason?: string;
  }[];
  scene?: SceneInfo;
};

export type PromptBundle = {
  stable: {
    system: string;
    characterSheet: string;
    state: string;
    bonds: string;
    facts: string;
    threads: string;
    lore: string;
  };
  dynamic: {
    arcSummary: string | null;
    retrievedMemories: EventRecord[];
    recentMessages: RawLogEntry[];
  };
  estimatedTokens: number;
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
};

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

export type FactType =
  | 'death'
  | 'injury'
  | 'secret'
  | 'knowledge'
  | 'membership'
  | 'possession'
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
  tags: string[];
};

export type EventRecord = {
  id: string;
  chapter: number;
  scene: string;
  inStoryDate: CalendarDate;
  summary: string;
  importance: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  pinned: boolean;
  sourceLogId: string | null;
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
  updatedInStoryDate: CalendarDate;
};

export type FactRecord = {
  id: string;
  subjectEntityId: string | null;
  type: FactType;
  text: string;
  whoKnows: string[];
  validFrom: CalendarDate;
  validTo: CalendarDate | null;
  confidence: 'confirmed' | 'rumored';
  sourceEventId: string | null;
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
  sourceEventId: string | null;
};

export type LoreRecord = {
  id: string;
  keywords: string[];
  priority: number;
  text: string;
  enabled: boolean;
  /** Narrator-only guidance; never shown in the Journal. */
  hidden?: boolean;
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
  | 'rejected';

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
  }[];
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
  canonCompleted?: string[];
  canonEngaged?: string[];
  canonPassed?: string[];
  newsRelayed?: { id: string; from?: string }[];
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

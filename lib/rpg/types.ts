export type CalendarDate = {
  year: number;
  month: number;
  day: number;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
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
  imageBrief?: string;
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
  romanceAccessibility?: 'winnable' | 'lore-locked';
  canonDevotion?: string;
  orientation?: string;
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
  contextMessages: number;
  retrievalLimit: number;
  autoSummarizeThreshold: number;
  temperature: number;
  maxTokens: number;
  canonProgress: boolean;
  autoAdvanceTime: boolean;
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
    advanceDays?: number;
    timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night';
    canonPoint?: string;
    chapter?: number;
    scene?: string;
    imageBrief?: string;
    sceneCast?: string[];
  };
  entities?: {
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
};

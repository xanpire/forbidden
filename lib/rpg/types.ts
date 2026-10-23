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
  rank: string;
  role: string;
  team: string[];
  sensei: string;
  personality: string[];
  secretNotes: string[];
};

export type GameState = {
  player: PlayerSheet;
  hp: { current: number; max: number };
  chakra: { current: number; max: number };
  jutsu: string[];
  inventory: string[];
  location: string;
  inStoryDate: CalendarDate;
  canonPoint: string;
  chapter: number;
  scene: string;
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
};

export type EntityRecord = {
  id: string;
  name: string;
  type: EntityType;
  aliases: string[];
  birthday?: { month: number; day: number };
  status?: string;
  notes?: string;
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
  contextMessages: number;
  retrievalLimit: number;
  autoSummarizeThreshold: number;
  temperature: number;
  maxTokens: number;
};

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
};

export type TurnDiff = {
  state?: {
    hpDelta?: number;
    chakraDelta?: number;
    jutsuAdded?: string[];
    jutsuRemoved?: string[];
    inventoryAdded?: string[];
    inventoryRemoved?: string[];
    location?: string;
    inStoryDate?: CalendarDate;
    canonPoint?: string;
    chapter?: number;
    scene?: string;
  };
  bonds?: {
    character: string;
    affinityDelta?: number;
    status?: string;
    note?: string;
    isMajor?: boolean;
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

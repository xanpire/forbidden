import { DEFAULT_DATE } from './calendar';
import { DEFAULT_SETTINGS, emptyIndex } from './defaults';
import { makeId } from './id';
import type {
  AppDatabase,
  BondRecord,
  EntityRecord,
  EventRecord,
  FactRecord,
  JutsuRecord,
  LoreRecord,
  ThreadRecord,
} from './types';

const ITACHI_ID = makeId('entity');
const HANA_ID = makeId('entity');
const IZUMI_ID = makeId('entity');
const SUZUME_ID = makeId('entity');
const KAN_ID = makeId('entity');
const FOREST_ID = makeId('entity');

export function seedDatabase(slotId: string, slotName: string): AppDatabase {
  const now = Date.now();

  const entities: EntityRecord[] = [
    {
      id: KAN_ID,
      name: 'Kan',
      type: 'character',
      aliases: ['Uchiha-Uzumaki Kan'],
      birthday: { month: 6, day: 30 },
      status: 'ANBU, missing from Konoha',
      notes: 'Original character. Uchiha-Uzumaki lineage, usually goes only by Kan.',
      mood: 'Numb, guarded, quietly exhausted',
      appearance: 'Lean teenage shinobi with black hair, dark watchful eyes, an ANBU cloak, and a pale porcelain mask hanging at his hip.',
      tags: ['player', 'uchiha', 'uzumaki', 'anbu'],
    },
    {
      id: ITACHI_ID,
      name: 'Itachi Uchiha',
      type: 'character',
      aliases: ['Itachi'],
      status: 'Missing-nin, Akatsuki',
      notes: 'Kan’s closest friend, like an older brother. Joined ANBU one year before Kan.',
      mood: 'Burdened, controlled, grieving beneath the calm',
      appearance: 'Slim young man with long black hair tied back, sharp dark eyes, tear troughs, and a black cloak patterned with red clouds.',
      tags: ['uchiha', 'anbu', 'akatsuki', 'friend'],
    },
    {
      id: HANA_ID,
      name: 'Hana Inuzuka',
      type: 'character',
      aliases: ['Hana'],
      status: 'Konoha shinobi',
      notes: 'Kan’s teammate. He has a secret crush on her.',
      mood: 'Worried, restless, fiercely loyal',
      appearance: 'Athletic girl with tousled brown hair, fang-like markings on her cheeks, and a practical Inuzuka jacket.',
      tags: ['inuzuka', 'team-3', 'crush'],
    },
    {
      id: IZUMI_ID,
      name: 'Izumi Uchiha',
      type: 'character',
      aliases: ['Izumi'],
      status: 'Deceased',
      notes: 'Kan’s teammate from Team 3.',
      mood: 'Remembered warmly',
      appearance: 'Young Uchiha girl with soft dark hair, gentle eyes, and the quiet posture of someone who always waited for others.',
      tags: ['uchiha', 'team-3'],
    },
    {
      id: SUZUME_ID,
      name: 'Suzume',
      type: 'character',
      aliases: ['Suzume-sensei'],
      status: 'Konoha jonin',
      notes: 'Former sensei of Team 3.',
      mood: 'Concerned, patient, watchful',
      appearance: 'Seasoned jonin woman with practical field clothes, tied-back hair, and the calm stance of a teacher who has buried students.',
      tags: ['team-3', 'sensei'],
    },
    {
      id: FOREST_ID,
      name: 'Forest outside Konoha',
      type: 'place',
      aliases: ['the woods', 'the forest'],
      notes: 'Rain-soaked meeting place after the Uchiha massacre.',
      tags: ['location', 'forest', 'rain'],
    },
    {
      id: makeId('entity'),
      name: 'Akatsuki',
      type: 'faction',
      aliases: ['the Akatsuki'],
      status: 'Active',
      notes: 'Itachi wants Kan to join as an inside spy.',
      tags: ['faction', 'akatsuki'],
    },
  ];

  const openingEvent: EventRecord = {
    id: makeId('event'),
    chapter: 1,
    scene: 'Rain-soaked forest meeting',
    inStoryDate: DEFAULT_DATE,
    summary:
      'Kan waits alone in the rain-soaked forest outside Konoha after the Uchiha massacre. He does not yet know Shisui is dead. Itachi is about to arrive and ask him to join Akatsuki.',
    importance: 5,
    tags: ['opening', 'itachi', 'massacre', 'rain', 'forest', 'akatsuki'],
    pinned: true,
    sourceLogId: null,
    createdAt: now,
  };

  const jutsuRecords: JutsuRecord[] = [
    {
      id: makeId('jutsu'),
      name: 'ANBU taijutsu',
      user: 'Kan',
      chakraNature: 'Physical',
      effect:
        'Close-quarters ANBU combat built for silent takedowns, precise strikes, and quick escapes.',
      visual:
        'Fast, economical movements with almost no sound; Kan closes distance in a low stance and ends exchanges in one or two blows.',
      firstSeen: DEFAULT_DATE,
      lastSeen: DEFAULT_DATE,
      timesUsed: 1,
      description: 'Close-quarters ANBU hand-to-hand combat focused on speed, silence, and precision.',
      tags: ['taijutsu', 'anbu', 'kan'],
    },
    {
      id: makeId('jutsu'),
      name: 'Fire Release',
      user: 'Kan',
      chakraNature: 'Fire',
      effect:
        'Uchiha-affinity fire techniques used to burn, signal, create pressure, or force an enemy back.',
      visual:
        'Chakra ignites into orange-red flames, often leaving heat shimmer and black scorch marks in the air.',
      firstSeen: DEFAULT_DATE,
      lastSeen: DEFAULT_DATE,
      timesUsed: 1,
      description: 'Uchiha-affinity fire techniques used for offense, signals, and pressure.',
      tags: ['fire', 'uchiha', 'kan'],
    },
  ];

  const bonds: BondRecord[] = [
    {
      id: makeId('bond'),
      entityId: ITACHI_ID,
      characterName: 'Itachi Uchiha',
      affinity: 8,
      status: 'Close friend, like an older brother',
      lastKeyEventId: openingEvent.id,
      note: 'They joined ANBU one year apart and trust each other deeply.',
      isMajor: true,
      updatedInStoryDate: DEFAULT_DATE,
    },
    {
      id: makeId('bond'),
      entityId: HANA_ID,
      characterName: 'Hana Inuzuka',
      affinity: 5,
      status: 'Teammate, secret crush',
      lastKeyEventId: null,
      note: 'Kan hides his feelings and has never told her.',
      isMajor: true,
      updatedInStoryDate: DEFAULT_DATE,
    },
    {
      id: makeId('bond'),
      entityId: IZUMI_ID,
      characterName: 'Izumi Uchiha',
      affinity: 4,
      status: 'Teammate',
      lastKeyEventId: null,
      note: 'Fellow Team 3 member.',
      isMajor: true,
      updatedInStoryDate: DEFAULT_DATE,
    },
    {
      id: makeId('bond'),
      entityId: SUZUME_ID,
      characterName: 'Suzume',
      affinity: 5,
      status: 'Former sensei',
      lastKeyEventId: null,
      note: 'Taught and guided Team 3.',
      isMajor: false,
      updatedInStoryDate: DEFAULT_DATE,
    },
  ];

  const facts: FactRecord[] = [
    {
      id: makeId('fact'),
      subjectEntityId: KAN_ID,
      type: 'death',
      text: 'Kan’s parents, Erisa and Banri, died in the Nine-Tails attack.',
      whoKnows: ['Kan', 'village elders'],
      validFrom: DEFAULT_DATE,
      validTo: null,
      confidence: 'confirmed',
      sourceEventId: openingEvent.id,
    },
    {
      id: makeId('fact'),
      subjectEntityId: KAN_ID,
      type: 'event',
      text: 'Kan was five years old when the Nine-Tails attacked.',
      whoKnows: ['Kan'],
      validFrom: DEFAULT_DATE,
      validTo: null,
      confidence: 'confirmed',
      sourceEventId: null,
    },
    {
      id: makeId('fact'),
      subjectEntityId: KAN_ID,
      type: 'membership',
      text: 'Kan joined ANBU at age 12, one year after Itachi.',
      whoKnows: ['Kan', 'ANBU command'],
      validFrom: DEFAULT_DATE,
      validTo: null,
      confidence: 'confirmed',
      sourceEventId: null,
    },
    {
      id: makeId('fact'),
      subjectEntityId: KAN_ID,
      type: 'secret',
      text: 'Kan has a crush on Hana Inuzuka and has never told her.',
      whoKnows: ['Kan'],
      validFrom: DEFAULT_DATE,
      validTo: null,
      confidence: 'confirmed',
      sourceEventId: null,
    },
    {
      id: makeId('fact'),
      subjectEntityId: ITACHI_ID,
      type: 'event',
      text: 'Itachi massacred the Uchiha clan.',
      whoKnows: ['Kan', 'Konoha leadership'],
      validFrom: DEFAULT_DATE,
      validTo: null,
      confidence: 'confirmed',
      sourceEventId: openingEvent.id,
    },
  ];

  const threads: ThreadRecord[] = [
    {
      id: makeId('thread'),
      type: 'mystery',
      title: 'What really happened to Shisui?',
      description:
        'Kan does not yet know Shisui is dead and wants to understand what happened.',
      status: 'open',
      openedAt: DEFAULT_DATE,
      resolvedAt: null,
      importance: 4,
      participants: ['Kan', 'Itachi'],
      sourceEventId: openingEvent.id,
    },
    {
      id: makeId('thread'),
      type: 'quest',
      title: 'Itachi’s offer: join Akatsuki',
      description:
        'Itachi is coming to ask Kan to join Akatsuki and spy on the organization from the inside.',
      status: 'open',
      openedAt: DEFAULT_DATE,
      resolvedAt: null,
      importance: 5,
      participants: ['Kan', 'Itachi'],
      sourceEventId: openingEvent.id,
    },
    {
      id: makeId('thread'),
      type: 'goal',
      title: 'Find a reason to keep going after the massacre',
      description:
        'Kan has left the village and is hiding in the woods, waiting for Itachi.',
      status: 'open',
      openedAt: DEFAULT_DATE,
      resolvedAt: null,
      importance: 4,
      participants: ['Kan'],
      sourceEventId: openingEvent.id,
    },
  ];

  const loreEntries: LoreRecord[] = [
    {
      id: makeId('lore'),
      keywords: ['uchiha', 'uzumaki', 'sharingan'],
      priority: 5,
      text: 'Kan is of mixed Uchiha-Uzumaki heritage. His Uchiha mother and Uzumaki father died in the Nine-Tails attack. He rarely mentions his clan names. He has not yet awakened the Sharingan.',
      enabled: true,
    },
    {
      id: makeId('lore'),
      keywords: ['nine-tails', 'kurma', 'kurama', 'attack'],
      priority: 5,
      text: 'The Nine-Tails attack killed Kan’s parents when he was five. It left him quiet, stoic, and reluctant to rely on others.',
      enabled: true,
    },
    {
      id: makeId('lore'),
      keywords: ['anbu'],
      priority: 4,
      text: 'ANBU are Konoha’s masked special forces. Kan joined at twelve, one year after Itachi. The work is secretive, dangerous, and morally gray.',
      enabled: true,
    },
  ];

  const database: AppDatabase = {
    schemaVersion: 1,
    meta: {
      slotId,
      slotName,
      createdAt: now,
      updatedAt: now,
    },
    settings: DEFAULT_SETTINGS,
    rawLog: [],
    entities,
    jutsuRecords,
    events: [openingEvent],
    eventEntities: [
      { eventId: openingEvent.id, entityId: KAN_ID, role: 'participant' },
      { eventId: openingEvent.id, entityId: ITACHI_ID, role: 'present' },
      { eventId: openingEvent.id, entityId: FOREST_ID, role: 'present' },
    ],
    bonds,
    facts,
    threads,
    loreEntries,
    summaries: [],
    state: {
      player: {
        name: 'Kan',
        lineage: ['Uchiha', 'Uzumaki'],
        birthday: { month: 6, day: 30 },
        birthYear: 0,
        rank: 'ANBU',
        role: 'Missing shinobi',
        team: ['Hana Inuzuka', 'Izumi Uchiha'],
        sensei: 'Suzume',
        personality: [
          'smart',
          'learns naturally',
          'dislikes studying',
          'quiet',
          'timid',
          'stoic',
          'hides his feelings',
        ],
        secretNotes: [
          'Has a secret crush on Hana Inuzuka.',
          'Rarely mentions his clan names.',
        ],
      },
      mood: 'Numb, guarded, quietly exhausted',
      worldDescription: 'The Hidden Leaf is scarred by the Nine-Tails attack and freshly wounded by the Uchiha massacre. The village is tense, watchful, and rebuilding in silence.',
      jutsu: ['ANBU taijutsu', 'Fire Release'],
      inventory: ['ANBU mask', 'Cloak', 'Tanto'],
      location: 'Forest outside Konoha',
      inStoryDate: DEFAULT_DATE,
      canonPoint: 'After the Uchiha massacre; Itachi is about to ask Kan to join Akatsuki.',
      chapter: 1,
      scene: 'Rain-soaked forest meeting',
    },
    indices: emptyIndex(),
    snapshots: [],
  };

  return database;
}

import { daysBetween, daysFromCivil, dateSortValue, shiftDate } from './calendar';
import type { AppDatabase, CalendarDate, ThreadType } from './types';

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

export type CanonThreadSeed = {
  title: string;
  description: string;
  type: ThreadType;
  participants?: string[];
  importance?: 1 | 2 | 3 | 4 | 5;
};

export type CanonEncounter = {
  who: string;
  where: string;
  context: string;
};

export type CanonMilestone = {
  id: string;
  era: string;
  title: string;
  description: string;
  canonPoint?: string;
  from: { year: number; month: number; day?: number };
  to?: { year: number; month: number; day?: number };
  minScenes: number;
  facts: string[];
  opensThreads?: CanonThreadSeed[];
  resolvesThreadTitles?: string[];
  encounter?: CanonEncounter;
  major?: boolean;
  playerDriven?: boolean;
  attendanceFact?: string;
};

// In-story timeline spine: Kan is 13 in year 13 (the massacre year) and matches
// Itachi's age throughout. Year 17-18 is Part 1, year 21 is Itachi's death,
// year 22-23 is the Fourth War. Windows use (year, month); day is ignored.
export const CANON_VERSION = 3;

export const CANON_MILESTONES: CanonMilestone[] = [
  {
    id: 'izumi-funeral',
    era: 'Ashes',
    title: "Izumi Uchiha's funeral",
    description:
      "Izumi Uchiha is buried with the rest of the clan. Hana and Suzume stand at the grave; Kan is a ghost at the edge of the ceremony.",
    from: { year: 13, month: 10, day: 6 },
    to: { year: 14, month: 3 },
    minScenes: 2,
    facts: ["Izumi Uchiha was buried with the Uchiha clan after the massacre."],
    encounter: {
      who: "Hana Inuzuka and Suzume",
      where: "the Uchiha cemetery outside Hidden Leaf",
      context:
        "Hana and Suzume are grieving and angry. Kan can attend in disguise, watch from the treeline, or stay away.",
    },
    attendanceFact: "Kan was at Izumi Uchiha's funeral.",
  },
  {
    id: 'kan-joins-akatsuki',
    era: 'Ashes',
    title: 'Kan joins the Akatsuki',
    description:
      'Kan accepts Itachi\'s offer and joins the Akatsuki beside him. Pain and Konan receive the two Uchiha into the rain-soaked organization.',
    canonPoint: 'Kan and Itachi have joined the Akatsuki together.',
    from: { year: 13, month: 10 },
    to: { year: 14, month: 3 },
    minScenes: 2,
    facts: [
      'Kan joined the Akatsuki together with Itachi Uchiha.',
      'Kan wears an Akatsuki cloak with red clouds.',
    ],
    resolvesThreadTitles: ['itachi’s offer: join akatsuki', 'itachi\'s offer: join akatsuki'],
    opensThreads: [
      {
        title: 'Prove yourself to the Akatsuki',
        description:
          'Kan must earn his place among the Akatsuki\'s monsters without giving them a reason to discard him.',
        type: 'goal',
        participants: ['Kan', 'Itachi Uchiha'],
        importance: 4,
      },
    ],
    major: true,
    playerDriven: true,
  },
  {
    id: 'masked-man-audience',
    era: 'Ashes',
    title: 'The masked man\'s audience',
    description:
      'Itachi is summoned to a secret meeting with a masked man who calls himself Madara Uchiha. Itachi invites Kan to come along; only those present learn that this masked man stands above the Akatsuki.',
    canonPoint: 'A masked man calling himself Madara Uchiha secretly stands above the Akatsuki.',
    from: { year: 13, month: 11 },
    to: { year: 15, month: 6 },
    minScenes: 3,
    facts: [],
    encounter: {
      who: 'the masked man (with Itachi Uchiha)',
      where: 'a hidden meeting arranged by Itachi',
      context:
        'The masked man wears an orange spiral mask and claims to be Madara Uchiha. Nobody sees his face — not Itachi, not Kan. If Kan attends, he hears the masked man\'s plans; if not, he learns nothing of this meeting.',
    },
    playerDriven: true,
    attendanceFact:
      'Kan attended Itachi\'s secret meeting with the masked man who calls himself Madara Uchiha.',
  },
  {
    id: 'akatsuki-rhythm',
    era: 'Ashes',
    title: 'First missions under the cloak',
    description:
      'Kan takes his first missions as an Akatsuki member — surveillance, retrieval, and quiet eliminations that teach him the organization\'s rhythm.',
    canonPoint: 'Kan is settling into life as an Akatsuki operative.',
    from: { year: 14, month: 1 },
    minScenes: 6,
    facts: ['Kan completed his first missions for the Akatsuki.'],
    playerDriven: true,
  },
  {
    id: 'mission-first-blood',
    era: 'Ashes',
    title: "The first execution",
    description:
      "Pain assigns Kan his first execution for the Akatsuki: a deserter whose mouth has grown too loud.",
    canonPoint: "Kan has blood on his hands from his first Akatsuki assignment.",
    from: { year: 14, month: 1 },
    to: { year: 15, month: 6 },
    minScenes: 6,
    facts: [],
    playerDriven: true,
    encounter: {
      who: "a marked Akatsuki target",
      where: "a border town",
      context:
        "The target begs, bargains, or fights. Kan decides what kind of Akatsuki he is becoming.",
    }
  },
  {
    id: 'juzo-death',
    era: 'Ashes',
    title: 'Jūzō Biwa falls in Kumo',
    description:
      'Itachi\'s first partner, Jūzō Biwa, dies fighting the Fourth Raikage\'s squad. The sentient blade Samehada passes to Kisame Hoshigaki.',
    canonPoint: 'Jūzō Biwa is dead; Samehada has passed to Kisame Hoshigaki.',
    from: { year: 14, month: 8 },
    to: { year: 15, month: 8 },
    minScenes: 10,
    facts: [
      'Jūzō Biwa, Itachi\'s first Akatsuki partner, died fighting the Fourth Raikage\'s squad.',
      'The sentient blade Samehada now belongs to Kisame Hoshigaki.',
    ],
    encounter: {
      who: 'Jūzō Biwa and Itachi Uchiha',
      where: 'a mission into the Land of Lightning',
      context:
        'Jūzō is Itachi\'s partner until his death against the Raikage\'s squad. Kan could be on this mission and witness his death.',
    },
    attendanceFact: 'Kan was on the mission when Jūzō Biwa fell to the Raikage\'s squad.',
  },
  {
    id: 'hana-hunt',
    era: 'The shadow war',
    title: "Hana's patrol",
    description:
      "Hana, now a chunin, leads a patrol that picks up Kan's trail. She has to decide whether the missing-nin in the cloak is still her teammate.",
    canonPoint: "Hana Inuzuka's patrol crossed Kan's trail.",
    from: { year: 14, month: 6 },
    to: { year: 16, month: 9 },
    minScenes: 8,
    facts: [],
    playerDriven: true,
    encounter: {
      who: "Hana Inuzuka",
      where: "the border woods of the Land of Fire",
      context:
        "Hana is torn between duty and memory. She may report Kan, warn him, or let him vanish.",
    },
    attendanceFact: "Kan crossed paths with Hana Inuzuka's patrol.",
  },
  {
    id: 'kisame-joins',
    era: 'Ashes',
    title: 'Kisame becomes Itachi\'s partner',
    description:
      'Kisame Hoshigaki, the Monster of the Hidden Mist, joins the Akatsuki and becomes Itachi\'s new partner.',
    canonPoint: 'Kisame Hoshigaki is Itachi\'s partner in the Akatsuki.',
    from: { year: 15, month: 1 },
    to: { year: 16, month: 6 },
    minScenes: 12,
    facts: ['Kisame Hoshigaki joined the Akatsuki as Itachi\'s partner.'],
    encounter: {
      who: 'Kisame Hoshigaki',
      where: 'the Akatsuki\'s ranks',
      context:
        'Kisame is introduced to Itachi — and to Kan, if Itachi brings him along. Samehada chose Kisame after Jūzō\'s death.',
    },
  },
  {
    id: 'suzume-inquiry',
    era: 'The shadow war',
    title: "Suzume's inquiry",
    description:
      "Suzume quietly investigates Kan's disappearance, the massacre, and the things Hidden Leaf will not say aloud.",
    canonPoint: "Suzume is quietly investigating what happened to Kan and the Uchiha.",
    from: { year: 15, month: 1 },
    to: { year: 17, month: 6 },
    minScenes: 12,
    facts: [],
    playerDriven: true,
    encounter: {
      who: "Suzume",
      where: "Hidden Leaf archives and the roads beyond",
      context:
        "Suzume follows records and rumors. She may find Kan, or find only the shape of the lie.",
    },
    attendanceFact: "Kan crossed paths with Suzume during her inquiry.",
  },
  {
    id: 'orochimaru-betrayal',
    era: 'Ashes',
    title: 'Orochimaru betrays the Akatsuki',
    description:
      'Orochimaru tries to steal Itachi\'s body and is caught in a single genjutsu. He loses his hand and defects from the organization.',
    canonPoint: 'Orochimaru has betrayed and left the Akatsuki after failing to take Itachi\'s body.',
    from: { year: 15, month: 6 },
    to: { year: 16, month: 6 },
    minScenes: 14,
    facts: [
      'Orochimaru tried to steal Itachi\'s body, lost his hand, and defected from the Akatsuki.',
    ],
    encounter: {
      who: 'Orochimaru and Itachi Uchiha',
      where: 'an Akatsuki hideout',
      context:
        'Orochimaru\'s ambush of Itachi ends with him trapped in genjutsu. Kan could witness the Snake Sannin\'s humiliation.',
    },
  },
  {
    id: 'mission-bounty',
    era: 'The shadow war',
    title: "The bounty that went wrong",
    description:
      "A bounty hunt with Itachi and Kisame goes wrong when the target turns out to be someone Kan knows.",
    canonPoint: "Kan's bounty mission went wrong.",
    from: { year: 15, month: 6 },
    to: { year: 17, month: 6 },
    minScenes: 14,
    facts: [],
    playerDriven: true,
    encounter: {
      who: "Kisame Hoshigaki and Itachi Uchiha",
      where: "a bounty station in the Land of Water",
      context:
        "The target is connected to Kan's past. Itachi watches what Kan chooses.",
    }
  },
  {
    id: 'deidara-recruited',
    era: 'Ashes',
    title: 'Deidara is recruited',
    description:
      'Itachi defeats the rogue artist Deidara in a duel, and Sasori mediates his recruitment into the Akatsuki.',
    canonPoint: 'Deidara has been recruited into the Akatsuki by Itachi\'s victory.',
    from: { year: 15, month: 8 },
    to: { year: 16, month: 8 },
    minScenes: 16,
    facts: ['Deidara was recruited into the Akatsuki after losing a duel to Itachi.'],
    encounter: {
      who: 'Deidara, Itachi Uchiha, and Sasori',
      where: 'Deidara\'s hideout',
      context:
        'The recruitment duel. Kan could accompany Itachi and meet the explosive artist and the puppet master Sasori.',
    },
  },
  {
    id: 'roster-completes',
    era: 'Ashes',
    title: 'The Akatsuki\'s roster completes',
    description:
      'Hidan, Kakuzu, and Zetsu fill the final rings. The Akatsuki\'s ten-member roster is complete, its true purpose still hidden.',
    canonPoint: 'The Akatsuki\'s full roster is complete: ten rings, ten monsters.',
    from: { year: 16, month: 1 },
    to: { year: 17, month: 4 },
    minScenes: 20,
    facts: [
      'The Akatsuki\'s roster is complete: Pain, Konan, Itachi, Kisame, Sasori, Deidara, Hidan, Kakuzu, Zetsu, and Tobi.',
    ],
  },
  {
    id: 'itachi-double-life',
    era: 'Ashes',
    title: 'Itachi\'s double life',
    description:
      'Itachi quietly feeds intelligence to Hidden Leaf while wearing the Akatsuki cloak. Kan may notice the errands his partner takes alone.',
    canonPoint: 'Rumors whisper that some Akatsuki members have loyalties besides the cloak.',
    from: { year: 14, month: 4 },
    to: { year: 17, month: 4 },
    minScenes: 8,
    facts: [],
    opensThreads: [
      {
        title: 'Who does Itachi really answer to?',
        description:
          'Itachi disappears on errands he never explains. Kan wonders where his friend\'s true loyalty lies.',
        type: 'mystery',
        participants: ['Kan', 'Itachi Uchiha'],
        importance: 3,
      },
    ],
  },
  {
    id: 'pain-civil-war',
    era: 'The shadow war',
    title: 'Pain\'s civil war in Hidden Rain',
    description:
      'Pain defeats Hanzo the Salamander and takes control of the Hidden Rain. The village begins to worship its new god.',
    canonPoint: 'Pain rules the Hidden Rain after defeating Hanzo.',
    from: { year: 15, month: 9 },
    to: { year: 16, month: 9 },
    minScenes: 16,
    facts: [
      'Pain defeated Hanzo the Salamander and seized control of the Hidden Rain Village.',
    ],
    encounter: {
      who: 'Pain and Konan',
      where: 'Hidden Rain, in the rain',
      context:
        'The civil war against Hanzo. Kan could witness Pain\'s power for the first time.',
    },
  },
  {
    id: 'ame-stronghold',
    era: 'The shadow war',
    title: 'Hidden Rain becomes the stronghold',
    description:
      'The Hidden Rain becomes the Akatsuki\'s home base. Kan\'s second home is a city of perpetual rain and worshipful eyes.',
    canonPoint: 'Hidden Rain serves as the Akatsuki\'s stronghold under Pain.',
    from: { year: 16, month: 2 },
    to: { year: 17, month: 6 },
    minScenes: 20,
    facts: ['The Hidden Rain Village is the Akatsuki\'s stronghold.'],
  },
  {
    id: 'kabuto-embedded',
    era: 'The shadow war',
    title: 'Kabuto embedded in Hidden Leaf',
    description:
      'Kabuto Yakushi becomes Sasori\'s spy inside Hidden Leaf, wearing the village\'s trust like a mask.',
    canonPoint: 'Kabuto Yakushi spies on Hidden Leaf for Sasori.',
    from: { year: 16, month: 4 },
    to: { year: 17, month: 6 },
    minScenes: 20,
    facts: ['Kabuto Yakushi works as Sasori\'s spy inside Hidden Leaf.'],
  },
  {
    id: 'kan-reputation',
    era: 'The shadow war',
    title: 'Kan\'s reputation grows',
    description:
      'A stray Uchiha in an Akatsuki cloak starts appearing in bounty ledgers and border reports. Nobody can quite place him.',
    canonPoint: 'Whispers spread of an unidentified Uchiha running with the Akatsuki.',
    from: { year: 14, month: 6 },
    to: { year: 17, month: 6 },
    minScenes: 12,
    facts: ['Bounty ledgers and border reports mention an unidentified Uchiha in an Akatsuki cloak.'],
    playerDriven: true,
  },
  {
    id: 'kan-life-outside',
    era: 'The shadow war',
    title: 'A life outside the cloak',
    description:
      'Between missions, Kan builds something of his own — safehouses, contacts, maybe someone close. The player shapes this through the story.',
    canonPoint: 'Kan keeps a private life hidden even from the Akatsuki.',
    from: { year: 14, month: 6 },
    to: { year: 17, month: 10 },
    minScenes: 10,
    facts: [],
    playerDriven: true,
  },
  {
    id: 'mission-ame-riot',
    era: 'The shadow war',
    title: "The rain riot",
    description:
      "A riot in Hidden Rain forces Kan to choose between the Akatsuki's order and the people under Pain's rain.",
    canonPoint: "Kan faced the people of Hidden Rain during a riot.",
    from: { year: 16, month: 6 },
    to: { year: 18, month: 6 },
    minScenes: 18,
    facts: [],
    playerDriven: true,
    encounter: {
      who: "Konan",
      where: "Hidden Rain's flooded streets",
      context:
        "Konan watches Kan handle the crowd. Pain's order is absolute; the people are starving.",
    }
  },
  {
    id: 'masked-man-rumors',
    era: 'The shadow war',
    title: 'Rumors of the masked man',
    description:
      'Whispers reach Kan of the masked man who was there the night of the massacre — the one who helped Itachi.',
    canonPoint: 'Kan has heard rumors of a masked man present at the massacre.',
    from: { year: 16, month: 6 },
    to: { year: 18, month: 6 },
    minScenes: 18,
    facts: ['Kan has heard rumors of a masked man who helped Itachi during the Uchiha massacre.'],
  },
  {
    id: 'rasa-assassinated',
    era: 'The shadow war',
    title: 'The Fourth Kazekage is assassinated',
    description:
      'Orochimaru murders Rasa, the Fourth Kazekage, and steals his identity for the exams to come.',
    canonPoint: 'The Fourth Kazekage is dead, killed and impersonated by Orochimaru.',
    from: { year: 17, month: 6 },
    to: { year: 18, month: 4 },
    minScenes: 24,
    facts: [
      'Orochimaru assassinated Rasa, the Fourth Kazekage, and impersonated him.',
    ],
  },
  {
    id: 'otogakure-grows',
    era: 'The shadow war',
    title: 'Hidden Sound rises',
    description:
      'Orochimaru\'s hidden Sound Village grows in secret — cursed seals, experiments, and an army of disposable shinobi.',
    canonPoint: 'Orochimaru\'s Hidden Sound Village is growing in secret.',
    from: { year: 16, month: 8 },
    to: { year: 18, month: 6 },
    minScenes: 20,
    facts: ['Orochimaru has built the Hidden Sound Village with cursed seals and experiments.'],
  },
  {
    id: 'team-7-formed',
    era: 'Part 1',
    title: 'Team 7 is formed',
    description:
      'The Nine-Tails\' host graduates the Academy. Kakashi Hatake takes on Naruto Uzumaki, Sasuke Uchiha, and Sakura Haruno.',
    canonPoint: 'Team 7 — Naruto, Sasuke, and Sakura under Kakashi — has just been formed.',
    from: { year: 17, month: 8 },
    to: { year: 18, month: 6 },
    minScenes: 26,
    facts: [
      'Naruto Uzumaki, Sasuke Uchiha, and Sakura Haruno formed Team 7 under Kakashi Hatake.',
    ],
  },
  {
    id: 'land-of-waves',
    era: 'Part 1',
    title: 'The Land of Waves',
    description:
      'Zabuza Momochi and Haku fall in the Land of Waves. Team 7 returns changed; the world barely notices.',
    canonPoint: 'Zabuza Momochi and Haku are dead; Team 7 survived the Land of Waves.',
    from: { year: 17, month: 10 },
    to: { year: 18, month: 8 },
    minScenes: 28,
    facts: [
      'Zabuza Momochi and Haku died in the Land of Waves.',
    ],
  },
  {
    id: 'kan-shadow-team-7',
    era: 'Part 1',
    title: 'Shadows over Team 7',
    description:
      'Kan crosses paths with the Hidden Leaf rookies from the outside — a figure in a cloak watching the team his village sent to hunt him.',
    canonPoint: 'Kan has seen Hidden Leaf\'s new genin from the shadows.',
    from: { year: 17, month: 10 },
    to: { year: 18, month: 10 },
    minScenes: 24,
    facts: [],
    encounter: {
      who: 'Naruto Uzumaki, Sasuke Uchiha, or Team 7',
      where: 'a road or border town Hidden Leaf\'s genin pass through',
      context:
        'Kan is five years older than these genin. They would see a stranger in a black cloak with red clouds — a dangerous man, not a peer. Kan chooses whether to show himself.',
    },
    playerDriven: true,
  },
  {
    id: 'chunin-exams',
    era: 'Part 1',
    title: 'The Chunin Exams convene',
    description:
      'Every village sends its genin to Hidden Leaf for the Chunin Exams — the rookies, Gaara of the Sand, and dangers hiding in every crowd.',
    canonPoint: 'The Chunin Exams are convening in Hidden Leaf.',
    from: { year: 18, month: 1 },
    to: { year: 18, month: 8 },
    minScenes: 30,
    facts: ['The Chunin Exams are being held in Hidden Leaf.'],
    encounter: {
      who: 'the exam crowds — Hidden Leaf rookies, Gaara of the Sand, and foreign genin',
      where: 'Hidden Leaf, in the exam halls and streets',
      context:
        'Hidden Leaf is full of foreign shinobi. A missing-nin could slip in disguised — or watch from outside the walls.',
    },
  },
  {
    id: 'sasuke-cursed-seal',
    era: 'Part 1',
    title: 'Sasuke is branded',
    description:
      'Orochimaru brands Sasuke Uchiha with the cursed seal in the Forest of Death.',
    canonPoint: 'Sasuke Uchiha carries Orochimaru\'s cursed seal.',
    from: { year: 18, month: 2 },
    to: { year: 18, month: 9 },
    minScenes: 32,
    facts: ['Orochimaru branded Sasuke Uchiha with the cursed seal.'],
  },
  {
    id: 'hayate-death',
    era: 'Part 1',
    title: "Hayate falls",
    description:
      "Gekko Hayate is killed by Baki of the Sand before the invasion, his body left in the dark.",
    canonPoint: "Gekko Hayate has been murdered before the invasion.",
    from: { year: 18, month: 2 },
    to: { year: 18, month: 10 },
    minScenes: 30,
    facts: ["Gekko Hayate was killed by Baki before the invasion of Hidden Leaf."],
  },
  {
    id: 'konoha-invasion',
    era: 'Part 1',
    title: 'The Invasion of Hidden Leaf',
    description:
      'Sand and Sound attack Hidden Leaf during the exams\' final round. The Third Hokage dies sealing Orochimaru\'s arms. The village burns.',
    canonPoint: 'The Third Hokage is dead; Hidden Leaf was invaded by Sand and Sound.',
    from: { year: 18, month: 3 },
    to: { year: 18, month: 10 },
    minScenes: 34,
    facts: [
      'Hidden Leaf was invaded by Sand and Sound forces; the Third Hokage, Hiruzen Sarutobi, died sealing Orochimaru\'s arms.',
    ],
    encounter: {
      who: 'Orochimaru, or the invading forces',
      where: 'Hidden Leaf, under attack',
      context:
        'The village Kan abandoned is burning. He could be inside the walls, outside them, or far away.',
    },
    major: true,
  },
  {
    id: 'team-3-reunion',
    era: 'Part 1',
    title: "The team that was",
    description:
      "After the invasion, Hana and Suzume cross Kan's path — the team that was, standing on opposite sides of the same war.",
    canonPoint: "Kan met Hana and Suzume again after the invasion.",
    from: { year: 18, month: 3 },
    to: { year: 19, month: 9 },
    minScenes: 34,
    facts: [],
    playerDriven: true,
    encounter: {
      who: "Hana Inuzuka and Suzume",
      where: "the ruined edge of Hidden Leaf",
      context:
        "Suzume wants answers; Hana wants to know why Kan abandoned them. Both still care, under the anger.",
    },
    attendanceFact: "Kan met Hana and Suzume after the invasion.",
  },
  {
    id: 'tsunade-hokage',
    era: 'Part 1',
    title: 'Tsunade becomes Fifth Hokage',
    description:
      'Tsunade Senju returns to Hidden Leaf and takes the hat of the Fifth Hokage with Jiraiya at her side.',
    canonPoint: 'Tsunade Senju is the Fifth Hokage of Hidden Leaf.',
    from: { year: 18, month: 4 },
    to: { year: 19, month: 2 },
    minScenes: 36,
    facts: ['Tsunade Senju became the Fifth Hokage.'],
  },
  {
    id: 'itachi-hunt-naruto',
    era: 'Part 1',
    title: 'Itachi and Kisame hunt the Nine-Tails',
    description:
      'Itachi and Kisame find Naruto Uzumaki at a roadside inn. Jiraiya intervenes, and the Akatsuki withdraws. Itachi\'s true purpose stays his own.',
    canonPoint: 'Itachi and Kisame were driven off by Jiraiya while hunting the Nine-Tails\' host.',
    from: { year: 18, month: 3 },
    to: { year: 19, month: 4 },
    minScenes: 30,
    facts: [
      'Itachi and Kisame attempted to capture Naruto Uzumaki but withdrew when Jiraiya intervened.',
    ],
    encounter: {
      who: 'Itachi Uchiha, Kisame Hoshigaki, Naruto Uzumaki, and Jiraiya',
      where: 'a roadside inn outside Hidden Leaf',
      context:
        'Itachi could ask Kan to accompany them on this mission — or Kan could follow them. What he sees of Itachi\'s hesitation is his to witness.',
    },
    playerDriven: true,
    attendanceFact:
      'Kan accompanied Itachi and Kisame on the mission to hunt the Nine-Tails\' host.',
  },
  {
    id: 'sasuke-defects',
    era: 'Part 1',
    title: 'Sasuke defects',
    description:
      'Sasuke Uchiha abandons Hidden Leaf for Orochimaru, escorted out by the Sound Four.',
    canonPoint: 'Sasuke Uchiha has defected from Hidden Leaf to Orochimaru.',
    from: { year: 18, month: 5 },
    to: { year: 19, month: 4 },
    minScenes: 36,
    facts: ['Sasuke Uchiha defected from Hidden Leaf to join Orochimaru.'],
  },
  {
    id: 'valley-of-the-end',
    era: 'Part 1',
    title: 'The Valley of the End',
    description:
      'Naruto fights Sasuke at the Valley of the End and fails to bring him home. The retrieval mission collapses.',
    canonPoint: 'Naruto failed to stop Sasuke at the Valley of the End.',
    from: { year: 18, month: 5 },
    to: { year: 19, month: 5 },
    minScenes: 36,
    facts: [
      'Naruto Uzumaki fought Sasuke Uchiha at the Valley of the End and failed to retrieve him.',
    ],
  },
  {
    id: 'kan-intercept-sasuke',
    era: 'Part 1',
    title: 'A fork in the road',
    description:
      'The night Sasuke flees Hidden Leaf, his path could cross Kan\'s. One conversation could change everything — or nothing.',
    canonPoint: 'Kan crossed paths with Sasuke Uchiha on the night of his defection.',
    from: { year: 18, month: 5 },
    to: { year: 19, month: 6 },
    minScenes: 34,
    facts: [],
    encounter: {
      who: 'Sasuke Uchiha',
      where: 'the roads out of the Land of Fire',
      context:
        'The Sound Four escort Sasuke toward Orochimaru. Kan is his older cousin\'s age and a missing-nin of the same clan. If Kan appears, Sasuke sees the clan\'s other survivor.',
    },
    playerDriven: true,
  },
  {
    id: 'sasuke-trains',
    era: 'The hidden years',
    title: 'Sasuke under Orochimaru',
    description:
      'Sasuke trains under Orochimaru\'s wing, and the cursed seal deepens its hold on him.',
    canonPoint: 'Sasuke trains under Orochimaru at Hidden Sound.',
    from: { year: 18, month: 7 },
    to: { year: 20, month: 6 },
    minScenes: 38,
    facts: ['Sasuke Uchiha is training under Orochimaru.'],
  },
  {
    id: 'naruto-trains',
    era: 'The hidden years',
    title: 'Naruto under Jiraiya',
    description:
      'Naruto leaves the village to train under Jiraiya. Hidden Leaf rebuilds around Tsunade.',
    canonPoint: 'Naruto is away training under Jiraiya.',
    from: { year: 18, month: 7 },
    to: { year: 20, month: 6 },
    minScenes: 38,
    facts: ['Naruto Uzumaki left Hidden Leaf to train under Jiraiya.'],
  },
  {
    id: 'itachi-illness',
    era: 'The hidden years',
    title: 'Itachi\'s hidden illness',
    description:
      'Itachi is dying — a disease he hides behind a calm mask. Whether he ever tells Kan is a matter between them.',
    canonPoint: 'Itachi hides a terminal illness.',
    from: { year: 19, month: 1 },
    to: { year: 21, month: 3 },
    minScenes: 40,
    facts: [],
    playerDriven: true,
  },
  {
    id: 'jinchuriki-hunt-decree',
    era: 'The hidden years',
    title: 'The jinchūriki hunt decreed',
    description:
      'The Leader sets the Akatsuki\'s true purpose in motion: capture all nine tailed beasts.',
    canonPoint: 'The Akatsuki has begun its hunt for the nine tailed beasts.',
    from: { year: 19, month: 2 },
    to: { year: 21, month: 1 },
    minScenes: 40,
    facts: ['The Akatsuki\'s true goal is to capture all nine tailed beasts.'],
  },
  {
    id: 'kan-hunt-role',
    era: 'The hidden years',
    title: 'Kan\'s role in the hunt',
    description:
      'The hunt assigns Kan a role: capture, surveillance, or quiet sabotage. The player chooses what his conscience allows.',
    canonPoint: 'Kan has taken his place in the Akatsuki\'s beast hunt.',
    from: { year: 19, month: 2 },
    to: { year: 21, month: 4 },
    minScenes: 38,
    facts: [],
    playerDriven: true,
  },
  {
    id: 'kan-sasuke-paths',
    era: 'The hidden years',
    title: 'Paths crossing again',
    description:
      'Sasuke, now stronger and hungrier, crosses Kan\'s path asking about Itachi.',
    canonPoint: 'Sasuke Uchiha has crossed paths with Kan again.',
    from: { year: 19, month: 1 },
    to: { year: 21, month: 6 },
    minScenes: 36,
    facts: [],
    encounter: {
      who: 'Sasuke Uchiha',
      where: 'anywhere Orochimaru\'s errands or Akatsuki missions overlap',
      context:
        'Sasuke wants Itachi\'s head and information about the Akatsuki. He would press Kan for both.',
    },
    playerDriven: true,
  },
  {
    id: 'gaara-kage',
    era: 'The hidden years',
    title: "Gaara becomes Kazekage",
    description:
      "Gaara becomes the Fifth Kazekage, the monster of the Sand remade as its protector.",
    canonPoint: "Gaara is the Fifth Kazekage.",
    from: { year: 20, month: 6 },
    to: { year: 21, month: 2 },
    minScenes: 40,
    facts: ["Gaara became the Fifth Kazekage."],
  },
  {
    id: 'izumi-grave',
    era: 'Shippuden',
    title: "Izumi's grave",
    description:
      "Kan returns to Izumi's grave. Hana is there, and neither of them has the words.",
    canonPoint: "Kan returned to Izumi's grave.",
    from: { year: 20, month: 6 },
    to: { year: 22, month: 12 },
    minScenes: 42,
    facts: [],
    playerDriven: true,
    encounter: {
      who: "Hana Inuzuka",
      where: "Izumi's grave outside Hidden Leaf",
      context:
        "Hana is visiting Izumi. The two survivors of Team 3 can talk, fight, or stand in silence.",
    },
    attendanceFact: "Kan met Hana at Izumi's grave.",
  },
  {
    id: 'gaara-captured',
    era: 'Shippuden',
    title: 'Gaara captured',
    description:
      'Deidara and Sasori capture Gaara of the Sand. The Shukaku is extracted, and Gaara dies — until Chiyo buys his life with her own.',
    canonPoint: 'Gaara was captured; the Shukaku was extracted; Chiyo\'s sacrifice revived him.',
    from: { year: 21, month: 1 },
    to: { year: 21, month: 7 },
    minScenes: 42,
    facts: [
      'Deidara and Sasori captured Gaara and extracted the Shukaku.',
      'Chiyo sacrificed her life to revive Gaara after the extraction.',
    ],
    major: true,
  },
  {
    id: 'sasori-falls',
    era: 'Shippuden',
    title: 'Sasori falls',
    description:
      'Sasori of the Red Sand dies in his grandmother Chiyo\'s arms, defeated by her and Sakura Haruno.',
    canonPoint: 'Sasori is dead, defeated by Chiyo and Sakura.',
    from: { year: 21, month: 2 },
    to: { year: 21, month: 8 },
    minScenes: 42,
    facts: ['Sasori of the Red Sand was killed by Chiyo and Sakura Haruno.'],
  },
  {
    id: 'naruto-sage-training',
    era: 'Shippuden',
    title: "Sage training",
    description:
      "Naruto trains sage mode at Mount Myoboku, learning stillness and the shape of the world's chakra.",
    canonPoint: "Naruto is training in sage mode at Mount Myoboku.",
    from: { year: 21, month: 3 },
    to: { year: 21, month: 9 },
    minScenes: 44,
    facts: ["Naruto Uzumaki trained in sage mode at Mount Myoboku."],
  },
  {
    id: 'team-kakashi-bridge',
    era: 'Shippuden',
    title: 'The bridge confrontation',
    description:
      'Naruto reaches Sasuke on a bridge and is pinned down. Sasuke walks away, declining to kill him.',
    canonPoint: 'Naruto confronted Sasuke on a bridge and was refused.',
    from: { year: 21, month: 3 },
    to: { year: 21, month: 9 },
    minScenes: 44,
    facts: ['Naruto confronted Sasuke at a bridge; Sasuke overpowered him but spared him.'],
  },
  {
    id: 'hidan-kakuzu',
    era: 'Shippuden',
    title: 'Hidan and Kakuzu',
    description:
      'Asuma Sarutobi dies against Hidan and Kakuzu. Shikamaru Nara hunts them down and ends them both.',
    canonPoint: 'Asuma is dead; Hidan and Kakuzu were destroyed by Shikamaru\'s vengeance.',
    from: { year: 21, month: 4 },
    to: { year: 21, month: 10 },
    minScenes: 44,
    facts: [
      'Asuma Sarutobi was killed by Hidan of the Akatsuki.',
      'Hidan was buried alive by Shikamaru Nara and Kakuzu was killed in the Nine-Tails\' chakra cloak.',
    ],
    encounter: {
      who: 'Hidan and Kakuzu',
      where: 'the Land of Fire, on their bounty circuit',
      context:
        'The immortal pair travel together collecting bounties. Kan could be assigned alongside them or cross their path.',
    },
    major: true,
  },
  {
    id: 'two-tails-captured',
    era: 'Shippuden',
    title: 'The Two-Tails captured',
    description:
      'Yugito Nii and the Two-Tails fall to Hidan and Kakuzu.',
    canonPoint: 'Yugito Nii and the Two-Tails have been captured by the Akatsuki.',
    from: { year: 21, month: 5 },
    to: { year: 21, month: 11 },
    minScenes: 46,
    facts: ['Yugito Nii, jinchūriki of the Two-Tails, was captured by the Akatsuki.'],
  },
  {
    id: 'three-tails-captured',
    era: 'Shippuden',
    title: 'The Three-Tails captured',
    description:
      'The masked man and Deidara capture the Three-Tails, working side by side for the first time.',
    canonPoint: 'The Three-Tails has been captured by the masked man and Deidara.',
    from: { year: 21, month: 6 },
    to: { year: 21, month: 12 },
    minScenes: 46,
    facts: ['The Three-Tails was captured by the masked man and Deidara.'],
    encounter: {
      who: 'the masked man and Deidara',
      where: 'a lake where the Three-Tails swims',
      context:
        'Kan could be assigned to this capture — his first long work alongside the masked man.',
    },
  },
  {
    id: 'sasuke-absorbs-orochimaru',
    era: 'Shippuden',
    title: 'Sasuke absorbs Orochimaru',
    description:
      'Sasuke turns on his weakened master and absorbs Orochimaru into himself. Team Hawk is formed.',
    canonPoint: 'Sasuke absorbed Orochimaru and formed Team Hawk.',
    from: { year: 21, month: 7 },
    to: { year: 22, month: 1 },
    minScenes: 48,
    facts: [
      'Sasuke absorbed Orochimaru and formed Team Hawk with Suigetsu, Karin, and Jūgo.',
    ],
  },
  {
    id: 'deidara-dies',
    era: 'Shippuden',
    title: 'Deidara\'s final masterpiece',
    description:
      'Deidara fights Sasuke for his brother\'s honor and detonates himself in a final work of art.',
    canonPoint: 'Deidara is dead, destroyed in his final battle against Sasuke.',
    from: { year: 21, month: 8 },
    to: { year: 22, month: 2 },
    minScenes: 48,
    facts: ['Deidara killed himself in a suicidal explosion attacking Sasuke.'],
  },
  {
    id: 'sasuke-rescue',
    era: 'Shippuden',
    title: 'Half-dead in the road',
    description:
      'Sasuke collapses after his battle with Deidara. In canon, the masked man retrieves him. Kan could be the one who finds him first.',
    canonPoint: 'Sasuke lay half-dead after Deidara\'s blast — and someone found him.',
    from: { year: 21, month: 8 },
    to: { year: 22, month: 2 },
    minScenes: 46,
    facts: [],
    encounter: {
      who: 'Sasuke Uchiha',
      where: 'the ruins of Deidara\'s battlefield',
      context:
        'Sasuke is unconscious and dying. Whoever reaches him first decides who he owes his life to.',
    },
    playerDriven: true,
  },
  {
    id: 'itachi-crow',
    era: 'Shippuden',
    title: "Itachi's crow",
    description:
      "Before his final battle, Itachi feeds Naruto a crow carrying Shisui's eye — insurance against a certain masked man.",
    canonPoint: "Itachi gave Naruto a crow carrying Shisui's eye.",
    from: { year: 21, month: 8 },
    to: { year: 22, month: 3 },
    minScenes: 50,
    facts: ["Itachi gave Naruto a crow carrying Shisui Uchiha's eye."],
  },
  {
    id: 'itachi-vs-sasuke',
    era: 'Shippuden',
    title: 'Itachi falls',
    description:
      'Itachi dies at Sasuke\'s hand in their final battle, his last touch pushing Sasuke out of the rain. His truth dies with him — for now.',
    canonPoint: 'Itachi Uchiha is dead, killed by Sasuke in their final battle.',
    from: { year: 21, month: 9 },
    to: { year: 22, month: 2 },
    minScenes: 50,
    facts: [
      'Itachi Uchiha died in battle against Sasuke.',
      'Itachi died still believing the masked man was Madara Uchiha.',
    ],
    encounter: {
      who: 'Itachi Uchiha and Sasuke Uchiha',
      where: 'an abandoned Uchiha hideout',
      context:
        'Itachi could ask Kan to stay away — or to be there. Whether Kan witnesses his friend\'s death is a player choice.',
    },
    major: true,
    attendanceFact: 'Kan witnessed Itachi\'s final battle and death against Sasuke.',
  },
  {
    id: 'masked-man-truth',
    era: 'Shippuden',
    title: 'The masked man\'s truth',
    description:
      'The masked man, still masked and still calling himself Madara, tells Sasuke that Hidden Leaf\'s leadership ordered the Uchiha massacre.',
    canonPoint: 'The masked man claims Hidden Leaf\'s leadership ordered the Uchiha massacre.',
    from: { year: 21, month: 9 },
    to: { year: 22, month: 3 },
    minScenes: 50,
    facts: [
      'The masked man told Sasuke that Hidden Leaf\'s leadership ordered the Uchiha massacre.',
    ],
    encounter: {
      who: 'the masked man (with Sasuke Uchiha)',
      where: 'the Uchiha hideout after Itachi\'s death',
      context:
        'The masked man remains masked and claims to be Madara. If Kan is present, he hears the massacre\'s true order — but still does not learn who the man is.',
    },
    major: true,
    attendanceFact:
      'Kan heard the masked man reveal that Hidden Leaf\'s leadership ordered the Uchiha massacre.',
  },
  {
    id: 'killer-bee-fail',
    era: 'Shippuden',
    title: 'Hawk hunts the Eight-Tails',
    description:
      'Sasuke\'s Team Hawk attacks Killer Bee and fails — the Eight-Tails\' host fakes his capture and escapes.',
    canonPoint: 'Team Hawk failed to capture Killer Bee and the Eight-Tails.',
    from: { year: 21, month: 10 },
    to: { year: 22, month: 4 },
    minScenes: 52,
    facts: ['Team Hawk failed to capture Killer Bee, the Eight-Tails\' jinchūriki.'],
  },
  {
    id: 'killer-bee-training',
    era: 'Shippuden',
    title: "Training with Killer Bee",
    description:
      "Naruto trains with Killer Bee to control the Nine-Tails' chakra.",
    canonPoint: "Naruto is training with Killer Bee to control the Nine-Tails.",
    from: { year: 21, month: 11 },
    to: { year: 22, month: 6 },
    minScenes: 52,
    facts: ["Naruto trained with Killer Bee to control the Nine-Tails."],
  },
  {
    id: 'itachi-posthumous',
    era: 'Shippuden',
    title: 'Itachi\'s posthumous plans',
    description:
      'Itachi left plans behind — a crow, a Shisui eye, a truth meant for Sasuke\'s eyes only. Whether Kan ever learns of them is a player matter.',
    canonPoint: 'Whispers circulate of plans Itachi left behind.',
    from: { year: 21, month: 10 },
    to: { year: 23, month: 3 },
    minScenes: 50,
    facts: [],
    playerDriven: true,
  },
  {
    id: 'jiraiya-dies',
    era: 'The sky falls',
    title: 'Jiraiya dies in the rain',
    description:
      'Jiraiya infiltrates Hidden Rain and dies against Pain, sending his final intel out with a coded message on Fukasaku\'s back.',
    canonPoint: 'Jiraiya is dead, killed by Pain in Hidden Rain.',
    from: { year: 21, month: 11 },
    to: { year: 22, month: 5 },
    minScenes: 52,
    facts: [
      'Jiraiya died fighting Pain in the Hidden Rain Village.',
    ],
    major: true,
  },
  {
    id: 'pain-assault',
    era: 'The sky falls',
    title: 'Pain\'s assault on Hidden Leaf',
    description:
      'Six bodies flatten Hidden Leaf. Naruto defeats Pain and meets Nagato, whose sacrifice revives the dead of the village.',
    canonPoint: 'Pain destroyed and was repelled from Hidden Leaf; Nagato sacrificed himself to revive the dead.',
    from: { year: 22, month: 1 },
    to: { year: 22, month: 6 },
    minScenes: 54,
    facts: [
      'Pain destroyed Hidden Leaf; Naruto defeated him and Nagato sacrificed his life to revive the dead.',
      'The world now knows Pain is Nagato, working with Konan.',
    ],
    encounter: {
      who: 'Pain',
      where: 'Hidden Leaf or Hidden Rain',
      context:
        'If Kan is in the rain city or the ruined Leaf, he sees the Six Paths of Pain at war.',
    },
    major: true,
  },
  {
    id: 'danzo-hokage',
    era: 'The sky falls',
    title: 'Danzo takes the hat',
    description:
      'Danzo Shimura maneuvers himself into the Sixth Hokage\'s seat.',
    canonPoint: 'Danzo Shimura is the Sixth Hokage.',
    from: { year: 22, month: 2 },
    to: { year: 22, month: 8 },
    minScenes: 56,
    facts: ['Danzo Shimura became the Sixth Hokage.'],
  },
  {
    id: 'kage-summit',
    era: 'The sky falls',
    title: 'The Five Kage Summit in the Land of Iron',
    description:
      'The five Kage meet in the Land of Iron to answer the Akatsuki. The masked man appears and declares war on the shinobi world.',
    canonPoint: 'At the summit in the Land of Iron, the masked man declared war on the shinobi world.',
    from: { year: 22, month: 3 },
    to: { year: 22, month: 9 },
    minScenes: 56,
    facts: [
      'At the Five Kage Summit, the masked man declared war on the shinobi world.',
    ],
    major: true,
  },
  {
    id: 'sasuke-rampage',
    era: 'The sky falls',
    title: 'Sasuke\'s rampage',
    description:
      'Sasuke attacks the Summit and is defeated by the Raikage and Kazekage. He then kills Danzo, the man who ordered his clan\'s death.',
    canonPoint: 'Sasuke attacked the Kage Summit and killed Danzo Shimura.',
    from: { year: 22, month: 4 },
    to: { year: 22, month: 10 },
    minScenes: 58,
    facts: [
      'Sasuke attacked the Five Kage Summit and killed Danzo Shimura.',
    ],
  },
  {
    id: 'kisame-dies',
    era: 'The sky falls',
    title: 'Kisame\'s end',
    description:
      'Kisame dies capturing intel for the Akatsuki, feeding his sword to the last and taking his own life in a water prison.',
    canonPoint: 'Kisame Hoshigaki is dead.',
    from: { year: 22, month: 5 },
    to: { year: 22, month: 11 },
    minScenes: 58,
    facts: ['Kisame Hoshigaki is dead.'],
  },
  {
    id: 'konan-falls',
    era: 'The sky falls',
    title: 'Konan falls',
    description:
      'Konan defends Nagato\'s grave from the masked man and dies in the burning paper ocean.',
    canonPoint: 'Konan is dead, killed by the masked man.',
    from: { year: 22, month: 6 },
    to: { year: 23, month: 1 },
    minScenes: 58,
    facts: ['Konan was killed by the masked man defending Nagato\'s grave.'],
  },
  {
    id: 'kabuto-pact',
    era: 'The sky falls',
    title: 'Kabuto\'s pact',
    description:
      'Kabuto Yakushi offers the masked man an army of Edo Tensei corpses, including Madara Uchiha himself.',
    canonPoint: 'Kabuto has allied with the masked man with an Edo Tensei army.',
    from: { year: 22, month: 7 },
    to: { year: 23, month: 2 },
    minScenes: 60,
    facts: [
      'Kabuto Yakushi allied with the masked man, bringing an army of Edo Tensei corpses.',
    ],
  },
  {
    id: 'kan-akatsuki-exit',
    era: 'The sky falls',
    title: 'Leaving the cloak',
    description:
      'War is coming and the Akatsuki is dissolving around Kan. Defect, stay, or play both sides — the player chooses.',
    canonPoint: 'Kan has made his choice about his place in the coming war.',
    from: { year: 22, month: 7 },
    to: { year: 23, month: 4 },
    minScenes: 56,
    facts: [],
    playerDriven: true,
  },
  {
    id: 'war-begins',
    era: 'The Fourth War',
    title: 'The Fourth Shinobi World War begins',
    description:
      'The five villages unite as the Allied Shinobi Forces against the Akatsuki\'s Zetsu army and the first Edo Tensei wave.',
    canonPoint: 'The Fourth Shinobi World War has begun.',
    from: { year: 22, month: 9 },
    to: { year: 23, month: 5 },
    minScenes: 60,
    facts: [
      'The five villages united as the Allied Shinobi Forces against the Akatsuki.',
      'The Fourth Shinobi World War has begun.',
    ],
    major: true,
  },
  {
    id: 'kan-war-side',
    era: 'The Fourth War',
    title: 'Kan\'s side of the war',
    description:
      'The Alliance, the Akatsuki, or himself alone — Kan picks his place in the world\'s last war.',
    canonPoint: 'Kan has chosen his side in the Fourth Shinobi World War.',
    from: { year: 22, month: 9 },
    to: { year: 23, month: 6 },
    minScenes: 58,
    facts: [],
    playerDriven: true,
  },
  {
    id: 'edo-itachi',
    era: 'The Fourth War',
    title: 'Edo Itachi',
    description:
      'Kabuto\'s Edo Tensei returns Itachi to the battlefield. Breaking free of the control, he fights beside Naruto and Killer Bee against Nagato — and Kan meets his brother again across the impossible divide.',
    canonPoint: 'Edo Tensei Itachi walks the battlefield again.',
    from: { year: 23, month: 1 },
    to: { year: 23, month: 8 },
    minScenes: 60,
    facts: [
      'Edo Tensei returned Itachi to the battlefield during the war.',
    ],
    encounter: {
      who: 'Itachi Uchiha (Edo Tensei)',
      where: 'the war battlefield',
      context:
        'Itachi is a reanimated corpse, free of Kabuto\'s control. The reunion with Kan is the timeline\'s hardest conversation.',
    },
    major: true,
    attendanceFact: 'Kan met Itachi again on the battlefield during the war.',
  },
  {
    id: 'team-3-war',
    era: 'The Fourth War',
    title: "Team 3 on the battlefield",
    description:
      "Hana Inuzuka and Suzume fight in the Allied Shinobi Forces. On a battlefield full of masked shinobi, the old team finds each other again.",
    canonPoint: "Kan met Hana and Suzume on the war's battlefield.",
    from: { year: 23, month: 1 },
    to: { year: 23, month: 10 },
    minScenes: 60,
    facts: [],
    major: true,
    playerDriven: true,
    encounter: {
      who: "Hana Inuzuka and Suzume",
      where: "a battlefield of the Fourth War",
      context:
        "Hana and Suzume are exhausted and outnumbered. Kan's side of the war matters more than ever here.",
    },
    attendanceFact: "Kan fought beside Hana and Suzume during the war.",
  },
  {
    id: 'madara-revived',
    era: 'The Fourth War',
    title: 'Madara is revived',
    description:
      'Kabuto\'s Edo Tensei returns the REAL Madara Uchiha to the war — the legend himself, not the masked man\'s borrowed name.',
    canonPoint: 'The real Madara Uchiha has been revived for the war.',
    from: { year: 23, month: 1 },
    to: { year: 23, month: 9 },
    minScenes: 62,
    facts: [
      'The real Madara Uchiha was revived by Edo Tensei during the war.',
    ],
    major: true,
  },
  {
    id: 'hokage-edo',
    era: 'The Fourth War',
    title: "The four Hokage return",
    description:
      "Orochimaru revives the four Hokage with Edo Tensei. Minato, Hashirama, Tobirama, and Hiruzen walk the battlefield again.",
    canonPoint: "The four Hokage have been revived by Edo Tensei.",
    from: { year: 23, month: 2 },
    to: { year: 23, month: 9 },
    minScenes: 62,
    facts: ["Orochimaru revived the four Hokage with Edo Tensei during the war."],
    major: true,
  },
  {
    id: 'obito-unmasked',
    era: 'The Fourth War',
    title: 'The mask breaks',
    description:
      'In the clash with Kakashi and Naruto, the masked man\'s mask shatters. The Alliance learns the truth: he is Obito Uchiha, Kakashi\'s teammate who died decades ago.',
    canonPoint: 'The masked man has been unmasked — he is Obito Uchiha.',
    from: { year: 23, month: 2 },
    to: { year: 23, month: 9 },
    minScenes: 62,
    facts: [
      'The masked man\'s mask shattered in battle; the Allied Forces learned he is Obito Uchiha, Kakashi\'s former teammate.',
    ],
    encounter: {
      who: 'the masked man (battling Kakashi and Naruto)',
      where: 'the war battlefield',
      context:
        'Only those on this battlefield see the mask break. If Kan is elsewhere, he learns it later — from witnesses.',
    },
    major: true,
    attendanceFact:
      'Kan saw the masked man\'s mask shatter against Kakashi and learned he is Obito Uchiha.',
  },
  {
    id: 'ten-tails',
    era: 'The Fourth War',
    title: 'The Ten-Tails resurrected',
    description:
      'Obito and Madara revive the Ten-Tails on the battlefield.',
    canonPoint: 'The Ten-Tails has been revived.',
    from: { year: 23, month: 3 },
    to: { year: 23, month: 10 },
    minScenes: 64,
    facts: ['Obito and Madara revived the Ten-Tails.'],
    major: true,
  },
  {
    id: 'shikaku-inoichi-death',
    era: 'The Fourth War',
    title: "Headquarters falls",
    description:
      "The Ten-Tails destroys the Alliance headquarters, killing Shikaku Nara and Inoichi Yamanaka.",
    canonPoint: "Shikaku Nara and Inoichi Yamanaka are dead.",
    from: { year: 23, month: 4 },
    to: { year: 23, month: 10 },
    minScenes: 64,
    facts: ["Shikaku Nara and Inoichi Yamanaka died when the Ten-Tails destroyed headquarters."],
  },
  {
    id: 'obito-jinchuriki',
    era: 'The Fourth War',
    title: 'Obito becomes the Ten-Tails\' jinchūriki',
    description:
      'Obito seals the Ten-Tails into himself and becomes a god on the battlefield.',
    canonPoint: 'Obito Uchiha is the Ten-Tails\' jinchūriki.',
    from: { year: 23, month: 4 },
    to: { year: 23, month: 10 },
    minScenes: 64,
    facts: ['Obito became the Ten-Tails\' jinchūriki.'],
    major: true,
  },
  {
    id: 'neji-death',
    era: 'The Fourth War',
    title: "Neji dies",
    description:
      "Neji Hyuga dies shielding Naruto and Hinata from the Ten-Tails' attack.",
    canonPoint: "Neji Hyuga is dead.",
    from: { year: 23, month: 5 },
    to: { year: 23, month: 11 },
    minScenes: 64,
    facts: ["Neji Hyuga died protecting Naruto and Hinata."],
    major: true,
  },
  {
    id: 'madara-betrayal',
    era: 'The Fourth War',
    title: 'Madara\'s betrayal',
    description:
      'Black Zetsu moves at last. Madara takes the Ten-Tails for himself, casting the Infinite Tsukuyomi\'s stage.',
    canonPoint: 'Madara betrayed Obito and took the Ten-Tails for himself.',
    from: { year: 23, month: 5 },
    to: { year: 23, month: 11 },
    minScenes: 66,
    facts: ['Madara betrayed Obito and took the Ten-Tails.'],
    major: true,
  },
  {
    id: 'kaguya-awakens',
    era: 'The Fourth War',
    title: "Kaguya returns",
    description:
      "Black Zetsu betrays Madara and Kaguya Otsutsuki returns, the true architect of the infinite dream.",
    canonPoint: "Kaguya Otsutsuki has returned.",
    from: { year: 23, month: 6 },
    to: { year: 23, month: 12 },
    minScenes: 66,
    facts: ["Kaguya Otsutsuki returned through Madara."],
    major: true,
  },
  {
    id: 'obito-redemption',
    era: 'The Fourth War',
    title: "Obito's choice",
    description:
      "Obito turns against Madara and dies protecting Kakashi and Naruto, choosing the boy he could have been.",
    canonPoint: "Obito Uchiha turned against Madara and died defending his old team.",
    from: { year: 23, month: 6 },
    to: { year: 24, month: 1 },
    minScenes: 66,
    facts: ["Obito Uchiha turned against Madara and died defending Kakashi and Naruto."],
    major: true,
  },
  {
    id: 'kaguya-sealed',
    era: 'The Fourth War',
    title: "The infinite dream ends",
    description:
      "Team 7 seals Kaguya and ends the infinite dream.",
    canonPoint: "Kaguya has been sealed by Team 7.",
    from: { year: 23, month: 7 },
    to: { year: 24, month: 1 },
    minScenes: 66,
    facts: ["Team 7 sealed Kaguya Otsutsuki."],
    major: true,
  },
  {
    id: 'war-ends',
    era: 'The Fourth War',
    title: 'The sealing',
    description:
      'The Allied Forces prevail and the Fourth Shinobi World War formally ends.',
    canonPoint: 'The Fourth Shinobi World War has ended.',
    from: { year: 23, month: 6 },
    to: { year: 24, month: 1 },
    minScenes: 66,
    facts: ['The Fourth Shinobi World War ended with the beast sealed.'],
    major: true,
  },
  {
    id: 'valleys-end',
    era: 'The Fourth War',
    title: 'The valley\'s end',
    description:
      'Naruto and Sasuke fight their final battle at the Valley of the End and release the infinite dream together.',
    canonPoint: 'Naruto and Sasuke ended their war at the Valley of the End.',
    from: { year: 23, month: 8 },
    to: { year: 24, month: 2 },
    minScenes: 68,
    facts: ['Naruto and Sasuke had their final battle and were both maimed by it.'],
    major: true,
  },
  {
    id: 'epilogue',
    era: 'After',
    title: 'The world after',
    description:
      'The villages rebuild. Kakashi and then Naruto take the hat in time. Kan\'s place in the new world is his to write.',
    canonPoint: 'The war is over and the villages are rebuilding.',
    from: { year: 24, month: 1 },
    to: { year: 25, month: 6 },
    minScenes: 70,
    facts: ['Kakashi Hatake became Hokage after the war.'],
    playerDriven: true,
  },
{
    id: 'sasuke-trial',
    era: 'After',
    title: "Sasuke's pardon",
    description:
      "Sasuke is pardoned and leaves Hidden Leaf to walk the world, atoning in his own way.",
    canonPoint: "Sasuke Uchiha has been pardoned and left Hidden Leaf.",
    from: { year: 24, month: 3 },
    to: { year: 25, month: 6 },
    minScenes: 68,
    facts: ["Sasuke Uchiha was pardoned and left Hidden Leaf to travel."],
  },
  {
    id: 'naruto-hokage',
    era: 'After',
    title: "The Seventh Hokage",
    description:
      "Years later, Naruto Uzumaki becomes the Seventh Hokage.",
    canonPoint: "Naruto Uzumaki is the Seventh Hokage.",
    from: { year: 25, month: 1 },
    to: { year: 27, month: 6 },
    minScenes: 70,
    facts: ["Naruto Uzumaki became the Seventh Hokage."],
    major: true,
  },
  {
    id: 'kan-legacy',
    era: 'After',
    title: "Kan's legacy",
    description:
      "Kan's place in the new world: the people he saved, the ones he lost, and what he leaves behind.",
    canonPoint: "Kan's story is settling into its legacy.",
    from: { year: 24, month: 1 },
    to: { year: 27, month: 12 },
    minScenes: 70,
    facts: [],
    playerDriven: true,
  },
];

const AUTO_MILESTONE_IDS = CANON_MILESTONES.filter(
  (milestone) => !milestone.playerDriven
).map((milestone) => milestone.id);

function windowKey(window: { year: number; month: number; day?: number }) {
  return daysFromCivil(window.year, window.month, window.day ?? 1);
}

function dateWindowKey(date: CalendarDate) {
  return windowKey(date);
}

function defaultProgress(): CanonProgress {
  return { version: CANON_VERSION, completed: [], active: [], engaged: [] };
}

function normalizeProgress(db: AppDatabase): CanonProgress {
  const progress = db.state.canonProgress;

  if (!progress || !Array.isArray(progress.completed)) {
    return defaultProgress();
  }

  return {
    version: typeof progress.version === 'number' ? progress.version : 1,
    baselineDate: progress.baselineDate,
    baselineTurn: typeof progress.baselineTurn === 'number' ? progress.baselineTurn : 0,
    completed: progress.completed.filter(Boolean),
    active: Array.isArray(progress.active) ? progress.active.filter(Boolean) : [],
    engaged: Array.isArray(progress.engaged) ? progress.engaged.filter(Boolean) : [],
    expired: Array.isArray((progress as { expired?: string[] }).expired)
      ? (progress as { expired?: string[] }).expired!.filter(Boolean)
      : [],
    heard:
      progress.heard && typeof progress.heard === 'object'
        ? progress.heard
        : {},
  };
}

function withProgress(db: AppDatabase, progress: CanonProgress): AppDatabase {
  return {
    ...db,
    state: {
      ...db.state,
      canonProgress: progress,
    },
  };
}

export function canonEnabled(db: AppDatabase): boolean {
  return db.settings.canonProgress !== false;
}

function prerequisitesMet(db: AppDatabase, index: number, completed: Set<string>): boolean {
  for (let prior = 0; prior < index; prior += 1) {
    const milestone = CANON_MILESTONES[prior];

    if (milestone.playerDriven) {
      continue;
    }

    if (!completed.has(milestone.id)) {
      return false;
    }
  }

  return true;
}

function resolveThread(db: AppDatabase, titleKey: string): AppDatabase {
  const lower = titleKey.toLowerCase();

  return {
    ...db,
    threads: db.threads.map((thread) =>
      thread.status === 'open' &&
      (thread.title.toLowerCase() === lower ||
        thread.title.toLowerCase().includes(lower))
        ? { ...thread, status: 'resolved', resolvedAt: db.state.inStoryDate }
        : thread
    ),
  };
}


function addMissedFact(db: AppDatabase, milestone: CanonMilestone): AppDatabase {
  if (!milestone.attendanceFact) {
    return db;
  }

  const missed = `Kan never crossed paths with ${
    milestone.encounter?.who ?? milestone.title
  } before this window closed.`;

  if (
    db.facts.some(
      (fact) => fact.validTo === null && fact.text.toLowerCase() === missed.toLowerCase()
    )
  ) {
    return db;
  }

  return {
    ...db,
    facts: [
      ...db.facts,
      {
        id: `fact_missed_${milestone.id}`,
        subjectEntityId: null,
        type: 'event',
        text: missed,
        whoKnows: ['Kan'],
        validFrom: db.state.inStoryDate,
        validTo: null,
        confidence: 'confirmed',
        sourceEventId: null,
      },
    ],
  };
}

function fireMilestone(db: AppDatabase, milestone: CanonMilestone): AppDatabase {
  const now = Date.now();
  const event = {
    id: `event_canon_${milestone.id}`,
    chapter: db.state.chapter,
    scene: 'Canon event',
    inStoryDate: db.state.inStoryDate,
    summary: `${milestone.title}: ${milestone.description}`.slice(0, 240),
    importance: (milestone.major ? 5 : 3) as 1 | 2 | 3 | 4 | 5,
    tags: ['canon', `canon-${milestone.id}`, milestone.era.toLowerCase()],
    pinned: Boolean(milestone.major),
    sourceLogId: null,
    createdAt: now,
  };

  let next: AppDatabase = {
    ...db,
    events: [...db.events, event],
  };

  for (const factText of milestone.facts) {
    if (
      next.facts.some(
        (fact) =>
          fact.validTo === null &&
          fact.text.toLowerCase() === factText.toLowerCase()
      )
    ) {
      continue;
    }

    next = {
      ...next,
      facts: [
        ...next.facts,
        {
          id: `fact_canon_${milestone.id}_${next.facts.length}`,
          subjectEntityId: null,
          type: 'event',
          text: factText.slice(0, 200),
          whoKnows: [],
          validFrom: db.state.inStoryDate,
          validTo: null,
          confidence: 'confirmed',
          sourceEventId: null,
        },
      ],
    };
  }

  if (milestone.resolvesThreadTitles) {
    for (const title of milestone.resolvesThreadTitles) {
      next = resolveThread(next, title);
    }
  }

  if (milestone.opensThreads) {
    for (const seed of milestone.opensThreads) {
      const lower = seed.title.toLowerCase();

      if (next.threads.some((thread) => thread.title.toLowerCase() === lower)) {
        continue;
      }

      next = {
        ...next,
        threads: [
          ...next.threads,
          {
            id: `thread_canon_${milestone.id}_${next.threads.length}`,
            type: seed.type,
            title: seed.title,
            description: seed.description,
            status: 'open',
            openedAt: db.state.inStoryDate,
            resolvedAt: null,
            importance: (seed.importance ?? 3) as 1 | 2 | 3 | 4 | 5,
            participants: seed.participants ?? [],
            sourceEventId: null,
          },
        ],
      };
    }
  }

  if (milestone.canonPoint) {
    next = {
      ...next,
      state: {
        ...next.state,
        canonPoint: milestone.canonPoint.slice(0, 220),
      },
    };
  }

  return next;
}

export function applyCanonMarks(
  db: AppDatabase,
  completedIds: string[],
  engagedIds: string[],
  passedIds: string[] = []
): AppDatabase {
  if (!canonEnabled(db)) {
    return db;
  }

  let next = db;
  let progress = normalizeProgress(next);
  const completed = new Set(progress.completed);

  for (const id of completedIds) {
    const milestone = CANON_MILESTONES.find((item) => item.id === id);

    if (!milestone) {
      continue;
    }

    if (!progress.completed.includes(id)) {
      if (!next.events.some((event) => event.id === `event_canon_${id}`)) {
        next = fireMilestone(next, milestone);
      }

      progress = { ...progress, completed: [...progress.completed, id] };
      completed.add(id);
    }

    const completedEventId = `event_canon_${id}`;

    progress = {
      ...progress,
      heard: {
        ...(progress.heard ?? {}),
        [completedEventId]: {
          from: 'witnessed',
          date: next.state.inStoryDate,
        },
      },
    };

    if (milestone.attendanceFact) {
      const attendance = milestone.attendanceFact;

      if (
        !next.facts.some(
          (fact) =>
            fact.validTo === null && fact.text.toLowerCase() === attendance.toLowerCase()
        )
      ) {
        next = {
          ...next,
          facts: [
            ...next.facts,
            {
              id: `fact_attended_${id}`,
              subjectEntityId: null,
              type: 'event',
              text: attendance,
              whoKnows: ['Kan'],
              validFrom: next.state.inStoryDate,
              validTo: null,
              confidence: 'confirmed',
              sourceEventId: null,
            },
          ],
        };
      }
    }

    progress = {
      ...progress,
      active: progress.active.filter((activeId) => activeId !== id),
      engaged: progress.engaged.filter((engagedId) => engagedId !== id),
    };
  }

  for (const id of engagedIds) {
    const milestone = CANON_MILESTONES.find((item) => item.id === id);

    if (!milestone || !milestone.playerDriven || progress.completed.includes(id)) {
      continue;
    }

    if (!next.events.some((event) => event.id === `event_canon_${id}`)) {
      next = fireMilestone(next, milestone);
    }

    progress = {
      ...progress,
      active: progress.active.includes(id) ? progress.active : [...progress.active, id],
      engaged: progress.engaged.includes(id) ? progress.engaged : [...progress.engaged, id],
    };
  }

  for (const id of passedIds) {
    const milestone = CANON_MILESTONES.find((item) => item.id === id);

    if (!milestone || milestone.attendanceFact === undefined) {
      continue;
    }

    if (!progress.completed.includes(id) && !next.events.some((event) => event.id === `event_canon_${id}`)) {
      next = fireMilestone(next, milestone);
    }

    progress = {
      ...progress,
      completed: progress.completed.includes(id)
        ? progress.completed
        : [...progress.completed, id],
      active: progress.active.filter((activeId) => activeId !== id),
      engaged: progress.engaged.filter((engagedId) => engagedId !== id),
    };
    next = addMissedFact(next, milestone);
  }

  progress = { ...progress, completed: [...new Set(progress.completed)] };

  return withProgress(next, progress);
}

export function advanceCanon(db: AppDatabase): AppDatabase {
  if (!canonEnabled(db)) {
    return db;
  }

  let next = db;
  let progress = normalizeProgress(next);
  const completed = new Set(progress.completed);
  const active = new Set(progress.active);
  const assistantTurns = next.rawLog.filter(
    (entry) => entry.kind === 'story' && entry.role === 'assistant'
  ).length;

  const needsBaseline =
    progress.version !== CANON_VERSION || !progress.baselineDate;

  if (needsBaseline) {
    progress = {
      ...progress,
      version: CANON_VERSION,
      baselineDate: next.state.inStoryDate,
      baselineTurn: assistantTurns,
    };
  }

  const baselineKey = progress.baselineDate
    ? windowKey(progress.baselineDate)
    : dateWindowKey(next.state.inStoryDate);
  const scenes = Math.max(0, assistantTurns - (progress.baselineTurn ?? assistantTurns));
  const dateKey = dateWindowKey(next.state.inStoryDate);
  const MAX_AUTO_FIRES_PER_TURN = 4;
  let autoFired = 0;

  for (let index = 0; index < CANON_MILESTONES.length; index += 1) {
    const milestone = CANON_MILESTONES[index];

    if (completed.has(milestone.id)) {
      continue;
    }

    if (milestone.to && windowKey(milestone.to) < baselineKey) {
      completed.add(milestone.id);
      progress = {
        ...progress,
        completed: progress.completed.includes(milestone.id)
          ? progress.completed
          : [...progress.completed, milestone.id],
        expired: [...new Set([...(progress.expired ?? []), milestone.id])],
      };
      continue;
    }

    const fromOpen = dateKey >= windowKey(milestone.from);
    const toOpen = !milestone.to || dateKey <= windowKey(milestone.to);

    if (progress.engaged.includes(milestone.id) && milestone.playerDriven) {
      if (!next.events.some((event) => event.id === `event_canon_${milestone.id}`)) {
        next = fireMilestone(next, milestone);
      }

      if (!progress.active.includes(milestone.id)) {
        progress = { ...progress, active: [...progress.active, milestone.id] };
      }

      continue;
    }

    if (milestone.playerDriven) {
      if (fromOpen && toOpen && scenes >= milestone.minScenes) {
        continue;
      }

      if (!toOpen) {
        completed.add(milestone.id);
        progress = { ...progress, completed: [...progress.completed, milestone.id] };
        next = addMissedFact(next, milestone);

        progress = {
          ...progress,
          active: progress.active.filter((activeId) => activeId !== milestone.id),
        };
      }

      continue;
    }

    if (
      fromOpen &&
      scenes >= milestone.minScenes &&
      prerequisitesMet(next, index, completed) &&
      autoFired < MAX_AUTO_FIRES_PER_TURN
    ) {
      if (!next.events.some((event) => event.id === `event_canon_${milestone.id}`)) {
        next = fireMilestone(next, milestone);
      }

      completed.add(milestone.id);
      autoFired += 1;
      progress = { ...progress, completed: [...progress.completed, milestone.id] };

      if (milestone.encounter) {
        if (toOpen) {
          active.add(milestone.id);
          progress = {
            ...progress,
            active: progress.active.includes(milestone.id)
              ? progress.active
              : [...progress.active, milestone.id],
          };
        } else {
          next = addMissedFact(next, milestone);
        }
      }
    }
  }

  for (const activeId of [...progress.active]) {
    const milestone = CANON_MILESTONES.find((item) => item.id === activeId);

    if (!milestone) {
      progress = {
        ...progress,
        active: progress.active.filter((id) => id !== activeId),
      };
      continue;
    }

    const expired = milestone.to ? dateKey > windowKey(milestone.to) : false;

    if (!expired) {
      continue;
    }

    const wasEngaged = progress.engaged.includes(activeId);

    completed.add(activeId);
    progress = {
      ...progress,
      completed: progress.completed.includes(activeId)
        ? progress.completed
        : [...progress.completed, activeId],
      active: progress.active.filter((id) => id !== activeId),
      engaged: progress.engaged.filter((id) => id !== activeId),
    };

    // A beat that was engaged already happened in-scene; it is not missed.
    if (!wasEngaged) {
      next = addMissedFact(next, milestone);
    }
  }

  progress = { ...progress, completed: [...new Set(progress.completed)] };

  return withProgress(next, progress);
}

export function canonProgressFor(db: AppDatabase): CanonProgress {
  return normalizeProgress(db);
}

export function activeCanonMilestones(db: AppDatabase): CanonMilestone[] {
  if (!canonEnabled(db)) {
    return [];
  }

  const progress = normalizeProgress(db);

  return CANON_MILESTONES.filter((milestone) =>
    progress.active.includes(milestone.id)
  );
}

export function upcomingCanonMilestones(db: AppDatabase, limit = 3): CanonMilestone[] {
  if (!canonEnabled(db)) {
    return [];
  }

  const progress = normalizeProgress(db);
  const completed = new Set(progress.completed);
  const dateKey = dateWindowKey(db.state.inStoryDate);

  return CANON_MILESTONES.filter(
    (milestone) =>
      milestone.playerDriven &&
      !completed.has(milestone.id) &&
      !progress.engaged.includes(milestone.id) &&
      dateKey >= windowKey(milestone.from) &&
      (!milestone.to || dateKey <= windowKey(milestone.to))
  ).slice(0, limit);
}

export function recentlyConcludedMilestones(db: AppDatabase, limit = 3): CanonMilestone[] {
  if (!canonEnabled(db)) {
    return [];
  }

  const progress = normalizeProgress(db);
  const completed = new Set(progress.completed);
  const expired = new Set(progress.expired ?? []);

  return CANON_MILESTONES.filter(
    (milestone) => completed.has(milestone.id) && !expired.has(milestone.id)
  )
    .slice(-limit)
    .reverse();
}


export function upcomingWorldMilestones(
  db: AppDatabase,
  days = 10
): { milestone: CanonMilestone; daysUntil: number }[] {
  if (!canonEnabled(db)) {
    return [];
  }

  const progress = normalizeProgress(db);
  const completed = new Set(progress.completed);
  const nowKey = dateWindowKey(db.state.inStoryDate);
  const horizon = shiftDate(db.state.inStoryDate, days);
  const horizonKey = dateWindowKey(horizon);

  return CANON_MILESTONES.filter((milestone) => {
    if (milestone.playerDriven || completed.has(milestone.id)) {
      return false;
    }

    const fromKey = windowKey(milestone.from);

    return fromKey > nowKey && fromKey <= horizonKey;
  })
    .map((milestone) => ({
      milestone,
      daysUntil: Math.max(
        0,
        daysBetween(db.state.inStoryDate, {
          year: milestone.from.year,
          month: milestone.from.month,
          day: milestone.from.day ?? 1,
          hour: 8,
          minute: 0,
          second: 0,
        })
      ),
    }))
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 3);
}

export function recentCanonEvents(db: AppDatabase, limit = 4) {
  return db.events
    .filter((event) => event.tags.includes('canon'))
    .sort((a, b) => dateSortValue(b.inStoryDate) - dateSortValue(a.inStoryDate))
    .slice(0, limit);
}

export function canonMilestoneById(id: string): CanonMilestone | undefined {
  return CANON_MILESTONES.find((milestone) => milestone.id === id);
}

export const CANON_ERA_ORDER = [
  'Ashes',
  'The shadow war',
  'Part 1',
  'The hidden years',
  'Shippuden',
  'The sky falls',
  'The Fourth War',
  'After',
];

export { AUTO_MILESTONE_IDS };
// ---------------------------------------------------------------------------
// World news: where events happen, who could know, and how word travels.
// ---------------------------------------------------------------------------

export type CanonKnowledge = 'public' | 'village' | 'akatsuki' | 'witnesses' | 'secret';

const LOCATION_BY_ID: Record<string, { region: string; location: string }> = {
  'izumi-funeral': { region: 'Land of Fire', location: 'the Uchiha cemetery outside the Hidden Leaf' },
  'kan-joins-akatsuki': { region: 'Hidden Rain', location: 'the Hidden Rain Village' },
  'masked-man-audience': { region: 'Land of Fire', location: 'a hidden meeting place near the Hidden Leaf' },
  'juzo-death': { region: 'Land of Lightning', location: 'the border passes of the Land of Lightning' },
  'kisame-joins': { region: 'Hidden Rain', location: 'the Hidden Rain Village' },
  'orochimaru-betrayal': { region: 'Hidden Rain', location: 'an Akatsuki hideout in the Hidden Rain' },
  'deidara-recruited': { region: 'Land of Earth', location: 'a stone quarry in the Land of Earth' },
  'roster-completes': { region: 'Hidden Rain', location: 'the Hidden Rain Village' },
  'pain-civil-war': { region: 'Hidden Rain', location: 'the Hidden Rain Village' },
  'ame-stronghold': { region: 'Hidden Rain', location: 'the Hidden Rain Village' },
  'kabuto-embedded': { region: 'Hidden Leaf', location: 'the Hidden Leaf Village' },
  'masked-man-rumors': { region: 'Land of Fire', location: 'the roads of the Land of Fire' },
  'rasa-assassinated': { region: 'Hidden Sand', location: 'the desert outside the Hidden Sand Village' },
  'otogakure-grows': { region: 'Hidden Sound', location: 'the Hidden Sound Village' },
  'team-7-formed': { region: 'Hidden Leaf', location: 'the Hidden Leaf Village' },
  'land-of-waves': { region: 'Land of Water', location: 'the Land of Waves' },
  'kan-shadow-team-7': { region: 'Land of Fire', location: 'the roads of the Land of Fire' },
  'chunin-exams': { region: 'Hidden Leaf', location: 'the Hidden Leaf Village' },
  'sasuke-cursed-seal': { region: 'Hidden Leaf', location: 'the Forest of Death' },
  'konoha-invasion': { region: 'Hidden Leaf', location: 'the Hidden Leaf Village' },
  'tsunade-hokage': { region: 'Hidden Leaf', location: 'the Hidden Leaf Village' },
  'itachi-hunt-naruto': { region: 'Land of Fire', location: 'a roadside inn outside the Hidden Leaf' },
  'sasuke-defects': { region: 'Land of Fire', location: 'the roads out of the Hidden Leaf' },
  'valley-of-the-end': { region: 'Land of Fire', location: 'the Valley of the End' },
  'kan-intercept-sasuke': { region: 'Land of Fire', location: 'the roads out of the Land of Fire' },
  'gaara-kage': { region: 'Hidden Sand', location: 'the Hidden Sand Village' },
  'izumi-grave': { region: 'Land of Fire', location: 'the Uchiha cemetery outside the Hidden Leaf' },
  'gaara-captured': { region: 'Hidden Sand', location: 'the Hidden Sand Village' },
  'sasori-falls': { region: 'Land of Wind', location: 'an Akatsuki cave lair in the Land of Wind' },
  'naruto-sage-training': { region: 'Land of Fire', location: 'Mount Myoboku' },
  'team-kakashi-bridge': { region: 'Land of Fire', location: 'a bridge in the Land of Fire' },
  'hidan-kakuzu': { region: 'Land of Fire', location: 'the forests of the Land of Fire' },
  'two-tails-captured': { region: 'Land of Lightning', location: 'the Land of Lightning' },
  'three-tails-captured': { region: 'Land of Water', location: 'a lake in the Land of Water' },
  'sasuke-absorbs-orochimaru': { region: 'Hidden Sound', location: 'the Hidden Sound Village' },
  'deidara-dies': { region: 'Land of Earth', location: 'the badlands of the Land of Earth' },
  'sasuke-rescue': { region: 'Land of Earth', location: 'the ruins of Deidara\'s battlefield' },
  'itachi-crow': { region: 'Land of Fire', location: 'a forest in the Land of Fire' },
  'itachi-vs-sasuke': { region: 'Land of Fire', location: 'an abandoned Uchiha hideout' },
  'masked-man-truth': { region: 'Land of Fire', location: 'the Uchiha hideout' },
  'killer-bee-fail': { region: 'Land of Lightning', location: 'the Land of Lightning' },
  'killer-bee-training': { region: 'Land of Lightning', location: 'the Falls of Truth' },
  'jiraiya-dies': { region: 'Hidden Rain', location: 'the Hidden Rain Village' },
  'pain-assault': { region: 'Hidden Leaf', location: 'the Hidden Leaf Village' },
  'danzo-hokage': { region: 'Hidden Leaf', location: 'the Hidden Leaf Village' },
  'kage-summit': { region: 'Land of Iron', location: 'the Summit hall in the Land of Iron' },
  'sasuke-rampage': { region: 'Land of Iron', location: 'the Land of Iron' },
  'kisame-dies': { region: 'Land of Lightning', location: 'the sea off the Land of Lightning' },
  'konan-falls': { region: 'Hidden Rain', location: 'the Hidden Rain Village' },
  'kabuto-pact': { region: 'Hidden Sound', location: 'a hidden lair of the Hidden Sound' },
  'war-begins': { region: 'Land of Lightning', location: 'the Fourth War front' },
  'hokage-edo': { region: 'Land of Lightning', location: 'the Fourth War front' },
  'madara-revived': { region: 'Land of Lightning', location: 'the Fourth War front' },
  'obito-unmasked': { region: 'Land of Lightning', location: 'the Fourth War front' },
  'ten-tails': { region: 'Land of Lightning', location: 'the Fourth War front' },
  'shikaku-inoichi-death': { region: 'Land of Lightning', location: 'the Allied headquarters' },
  'obito-jinchuriki': { region: 'Land of Lightning', location: 'the Fourth War front' },
  'neji-death': { region: 'Land of Lightning', location: 'the Fourth War front' },
  'madara-betrayal': { region: 'Land of Lightning', location: 'the Fourth War front' },
  'kaguya-awakens': { region: 'Land of Lightning', location: 'the Fourth War front' },
  'obito-redemption': { region: 'Land of Lightning', location: 'the Fourth War front' },
  'kaguya-sealed': { region: 'Land of Lightning', location: 'the Fourth War front' },
  'war-ends': { region: 'Land of Lightning', location: 'the Fourth War front' },
  'valleys-end': { region: 'Land of Fire', location: 'the Valley of the End' },
};

const KNOWLEDGE_BY_ID: Record<string, CanonKnowledge> = {
  'izumi-funeral': 'village',
  'kan-joins-akatsuki': 'akatsuki',
  'masked-man-audience': 'secret',
  'juzo-death': 'akatsuki',
  'kisame-joins': 'akatsuki',
  'orochimaru-betrayal': 'akatsuki',
  'deidara-recruited': 'akatsuki',
  'roster-completes': 'akatsuki',
  'pain-civil-war': 'public',
  'ame-stronghold': 'akatsuki',
  'itachi-double-life': 'secret',
  'masked-man-rumors': 'village',
  'gaara-captured': 'public',
  'sasori-falls': 'akatsuki',
  'hidan-kakuzu': 'public',
  'two-tails-captured': 'akatsuki',
  'three-tails-captured': 'akatsuki',
  'killer-bee-fail': 'akatsuki',
  'itachi-crow': 'secret',
  'itachi-vs-sasuke': 'witnesses',
  'masked-man-truth': 'secret',
  'itachi-posthumous': 'secret',
  'itachi-illness': 'secret',
  'jiraiya-dies': 'public',
  'pain-assault': 'public',
  'kage-summit': 'public',
  'sasuke-rampage': 'public',
  'kisame-dies': 'akatsuki',
  'konan-falls': 'akatsuki',
  'kabuto-pact': 'akatsuki',
  'war-begins': 'public',
  'hokage-edo': 'public',
  'madara-revived': 'public',
  'obito-unmasked': 'witnesses',
  'neji-death': 'public',
  'obito-redemption': 'witnesses',
  'kaguya-awakens': 'public',
  'kaguya-sealed': 'public',
  'war-ends': 'public',
  'valleys-end': 'witnesses',
  'sasuke-trial': 'public',
  'naruto-hokage': 'public',
};

const BEARERS_BY_KNOWLEDGE: Record<CanonKnowledge, string[]> = {
  akatsuki: ['Itachi Uchiha', 'Kisame Hoshigaki', 'Konan', 'Pain', 'Sasori', 'Deidara', 'Zetsu'],
  village: ['Hana Inuzuka', 'Suzume', 'Itachi Uchiha'],
  public: ['Itachi Uchiha', 'Hana Inuzuka', 'Suzume', 'a traveling merchant', 'a bounty-station keeper'],
  witnesses: [],
  secret: [],
};

const SECRET_BEARERS: Record<string, string[]> = {
  'masked-man-audience': ['Itachi Uchiha'],
  'itachi-double-life': ['Itachi Uchiha'],
  'itachi-crow': ['Itachi Uchiha', 'Naruto Uzumaki'],
  'masked-man-truth': ['Sasuke Uchiha', 'the masked man'],
  'itachi-posthumous': ['Itachi Uchiha', 'Naruto Uzumaki', 'Sasuke Uchiha'],
  'itachi-illness': ['Itachi Uchiha'],
};

const CHANNEL_BY_KNOWLEDGE: Record<CanonKnowledge, string> = {
  akatsuki: "Itachi's crow, Konan's paper butterfly, or Zetsu",
  village: 'a Leaf messenger hawk or a Hidden Leaf courier',
  public: 'a traveling merchant, a town crier, or a bounty-station bulletin',
  witnesses: 'only someone who was actually there',
  secret: 'only a named confidant, face to face',
};

export function milestoneRegion(milestone: CanonMilestone): string {
  return LOCATION_BY_ID[milestone.id]?.region ?? 'the shinobi world';
}

export function milestoneLocation(milestone: CanonMilestone): string {
  return LOCATION_BY_ID[milestone.id]?.location ?? milestoneRegion(milestone);
}

export function milestoneKnowledge(milestone: CanonMilestone): CanonKnowledge {
  return KNOWLEDGE_BY_ID[milestone.id] ?? 'public';
}

export function milestoneBearers(milestone: CanonMilestone): string[] {
  const knowledge = milestoneKnowledge(milestone);

  if (knowledge === 'secret') {
    return SECRET_BEARERS[milestone.id] ?? [];
  }

  return BEARERS_BY_KNOWLEDGE[knowledge];
}

const REGION_CHANNEL: Record<string, string> = {
  'Hidden Sand': 'a desert caravan or a Sand courier bird',
  'Land of Wind': 'a desert caravan or a Sand courier bird',
  'Hidden Mist': "a sailor or a ship's captain out of the Mist",
  'Land of Water': "a sailor or a ship's captain out of the Mist",
  'Hidden Cloud': 'a swift Cloud runner',
  'Land of Lightning': 'a swift Cloud runner',
  'Hidden Stone': 'a stone-route courier',
  'Land of Earth': 'a stone-route courier',
  'Land of Iron': 'a samurai rider or an official envoy',
  'Hidden Rain': "Itachi's crow or Konan's paper butterfly",
};

export function milestoneChannel(milestone: CanonMilestone): string {
  const knowledge = milestoneKnowledge(milestone);

  if (knowledge === 'public' || knowledge === 'village') {
    const regional = REGION_CHANNEL[milestoneRegion(milestone)];

    if (regional) {
      return regional;
    }
  }

  return CHANNEL_BY_KNOWLEDGE[knowledge];
}

export type UnheardNews = {
  eventId: string;
  milestoneId: string;
  title: string;
  summary: string;
  date: CalendarDate;
  major: boolean;
  region: string;
  location: string;
  bearers: string[];
  channel: string;
  knowledge: CanonKnowledge;
  daysOld: number;
};

export function unheardCanonNews(db: AppDatabase, limit = 3): UnheardNews[] {
  if (!canonEnabled(db)) {
    return [];
  }

  const progress = normalizeProgress(db);
  const heard = progress.heard ?? {};

  const news: UnheardNews[] = [];

  for (const event of db.events) {
    if (!event.tags.includes('canon')) {
      continue;
    }

    const milestoneId = event.id.replace('event_canon_', '');
    const milestone = CANON_MILESTONES.find((item) => item.id === milestoneId);

    if (!milestone || heard[event.id]) {
      continue;
    }

    news.push({
      eventId: event.id,
      milestoneId,
      title: milestone.title,
      summary: milestone.description,
      date: event.inStoryDate,
      major: Boolean(milestone.major),
      region: milestoneRegion(milestone),
      location: milestoneLocation(milestone),
      bearers: milestoneBearers(milestone),
      channel: milestoneChannel(milestone),
      knowledge: milestoneKnowledge(milestone),
      daysOld: Math.max(0, daysBetween(event.inStoryDate, db.state.inStoryDate)),
    });
  }

  return news
    .sort((a, b) => {
      if (a.major !== b.major) {
        return a.major ? -1 : 1;
      }

      return (
        a.date.year * 10000 + a.date.month * 100 + a.date.day -
        (b.date.year * 10000 + b.date.month * 100 + b.date.day)
      );
    })
    .slice(0, limit);
}

export function markNewsHeard(
  db: AppDatabase,
  relays: { id: string; from?: string }[]
): AppDatabase {
  if (!canonEnabled(db) || relays.length === 0) {
    return db;
  }

  const progress = normalizeProgress(db);
  const heard = { ...(progress.heard ?? {}) };

  for (const relay of relays) {
    const eventId = relay.id.startsWith('event_canon_')
      ? relay.id
      : `event_canon_${relay.id}`;
    const event = db.events.find((item) => item.id === eventId);

    if (!event) {
      continue;
    }

    heard[eventId] = {
      from: relay.from?.trim() || 'a rumor',
      date: db.state.inStoryDate,
    };
  }

  return withProgress(db, { ...progress, heard });
}

export function hasHeardNews(db: AppDatabase, eventId: string): boolean {
  const progress = normalizeProgress(db);
  return Boolean(progress.heard?.[eventId]);
}

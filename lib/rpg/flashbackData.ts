/**
 * The eighteen playable flashbacks of Kan's life before the story (ages 0–13).
 * Data only; the engine lives in flashbacks.ts.
 *
 * Kan, Itachi, Izumi and Hana are born in year 0, Shisui in year -3, Sasuke
 * and Naruto in year 5. Team 3 (Kan, Hana, Izumi, with Suzume as sensei) runs
 * from Kan's graduation at 9 until he joins ANBU at 12; after that he meets
 * them as friends, never as their teammate.
 */
import type { CalendarDate, LocationKind } from './types';

export type FlashbackTriggers = {
  /** Words in the present scene (the last reply and Kan's input). */
  words?: RegExp;
  /** People in the present scene, by their entity name. */
  people?: string[];
  /** Map place ids or place words in the present location. */
  places?: { ids?: string[]; words?: RegExp };
  /** Days of the year it fits, within FLASHBACK_DATE_WINDOW days. */
  dates?: { month: number; day: number }[];
  /** Personal beats or world milestones reached in the last few days. */
  beats?: string[];
  /** Only right after a fight (Kan's own first kill, the fight with Itachi). */
  afterFight?: boolean;
};

export type FlashbackRecord = {
  id: string;
  /** Its place in Kan's life, 1–18. */
  number: number;
  title: string;
  date: CalendarDate;
  place: string;
  locationKind: LocationKind;
  /** Who is in it, by entity name (Erisa and Banri are made when needed). */
  cast: string[];
  /** What the scene is, for the narrator. */
  scene: string;
  /** How some of them were at the time. */
  castNotes?: string[];
  /** Ideas for the trigger the narrator lets touch Kan in the present. */
  hint: string;
  triggers: FlashbackTriggers;
  /** What the memory cannot change. */
  fixed: string[];
  /** What it must never show or tell Kan. */
  hidden?: string[];
  /** Milestones Kan must have reached first. */
  requires?: string[];
  /** The memory a sentence long, until its write-up lands. */
  memoryLine: string;
  importance: 3 | 4 | 5;
};

/** Kan's mother and father: not in the canon cast, made when a flashback needs them. */
export const KAN_PARENTS = [
  {
    name: 'Erisa Uchiha',
    aliases: ['Erisa'],
    role: 'Your mother · Leaf kunoichi of the Uchiha clan',
    personality: 'Steady and warm, quick to laugh, fierce when it counts.',
    speechStyle: 'Plain and direct, teasing when she is at ease.',
    appearance: 'Dark hair worn tied back, the Uchiha dark eyes, the clan crest on her collar.',
    gender: 'female' as const,
  },
  {
    name: 'Banri Uzumaki',
    aliases: ['Banri'],
    role: 'Your father · an Uzumaki of the Leaf',
    personality: 'Gentle and patient, a storyteller, stubborn about the old Uzumaki ways.',
    speechStyle: 'Slow and warm; tells stories when he means advice.',
    appearance: 'Red hair, kind eyes, the Uzumaki swirl stitched on his sleeve.',
    gender: 'male' as const,
  },
];

const at = (year: number, month: number, day: number, hour: number, minute = 0): CalendarDate => ({
  year,
  month,
  day,
  hour,
  minute,
  second: 0,
});

const NO_SHISUI_TRUTH =
  'how Shisui will die, what Danzō does, or where Shisui’s eyes go';

export const FLASHBACKS: FlashbackRecord[] = [
  // ---------------------------------------------------------------------
  // Early childhood
  {
    id: 'three-boys',
    number: 1,
    title: 'Three boys',
    date: at(4, 6, 9, 15),
    place: 'the Uchiha district, Hidden Leaf',
    locationKind: 'settlement',
    cast: ['Itachi Uchiha', 'Shisui Uchiha', 'Mikoto Uchiha'],
    scene:
      'The first real day you, Itachi and Shisui spend together: Itachi’s fourth birthday, the Uchiha district streets and rooftops, the three of you on your own for an afternoon.',
    castNotes: [
      'Shisui, six, already acts like the big brother: he leads, shows off a little, and keeps the two small ones out of trouble.',
      'Itachi, just four, is quiet and watches everything.',
    ],
    hint: 'a quiet moment beside Itachi, children running past, the Uchiha district, Itachi’s birthday',
    triggers: {
      people: ['Itachi Uchiha'],
      places: { ids: ['uchiha-district'], words: /\buchiha district\b/i },
      dates: [{ month: 6, day: 9 }],
      words: /\b(when we were (small|little|kids|children)|as (kids|children)|growing up|childhood)\b/i,
    },
    fixed: ['The three of you become inseparable from here on.'],
    memoryLine: 'The first day you, Itachi and Shisui spent together, in the Uchiha district on Itachi’s fourth birthday.',
    importance: 3,
  },
  {
    id: 'erisa-and-banri',
    number: 2,
    title: 'Erisa and Banri',
    date: at(5, 4, 20, 10),
    place: 'your family’s house at the edge of the Uchiha district, Hidden Leaf',
    locationKind: 'structure',
    cast: ['Erisa Uchiha', 'Banri Uzumaki'],
    scene:
      'An ordinary spring day at home with your Uchiha mother and your Uzumaki father. Banri tells you about Uzushio, the island village of the Uzumaki, the way his own people told it to him.',
    hint: 'the Uzumaki swirl, the sea, a red-haired stranger, someone saying the name Uzushio',
    triggers: {
      beats: ['uzushio-ruins', 'uzumaki-masks', 'karin-uzumaki-blood', 'uzushio-return'],
      places: { ids: ['uzushio'] },
      words: /\b(uzushio|uzushiogakure|whirlpools?|uzumaki)\b/i,
    },
    fixed: [
      'Erisa and Banri are alive and well; nothing happens to them today.',
      'Uzushio fell long before you were born; Banri knows it only from his people’s stories and his own childhood.',
    ],
    hidden: ['anything about Kushina carrying the Nine-Tails'],
    memoryLine: 'A spring day at home with your mother and father, and Banri’s stories of Uzushio.',
    importance: 4,
  },
  {
    id: 'the-battlefield',
    number: 3,
    title: 'The battlefield',
    date: at(4, 9, 14, 18, 30),
    place: 'your family’s house in the Uchiha district, Hidden Leaf',
    locationKind: 'structure',
    cast: ['Erisa Uchiha', 'Banri Uzumaki', 'Itachi Uchiha'],
    scene:
      'The last days of the Third War. Erisa and Banri come home from the front after weeks away, while you waited not knowing if they would. The same week Fugaku took four-year-old Itachi to see a battlefield, and Itachi has barely spoken since; when he finally talks to you about it, it comes only in pieces.',
    castNotes: [
      'Itachi, four, carries something he cannot share: the first time you see him like that.',
      'Banri can tell the Uzumaki side of the war: Kushina, and the Seven Swordsmen of the Mist.',
    ],
    hint: 'a field of dead, the smell after a battle, a soldier home from a war, talk of the war',
    triggers: {
      words: /\b(battlefield|field of (the )?dead|war dead|fourth (great )?(ninja|shinobi) war|third (great )?(ninja|shinobi) war)\b/i,
      beats: ['naruto-joins-war'],
    },
    fixed: [
      'The Third War ends this year.',
      'Erisa and Banri come home from it alive; the Nine-Tails takes them a year later, but nobody knows that yet.',
      'Itachi saw the battlefield; it shapes him for life.',
    ],
    hidden: ['the Nine-Tails attack that is coming'],
    memoryLine: 'The week your parents came home from the Third War, and Itachi came back from the battlefield changed.',
    importance: 4,
  },
  {
    id: 'sasuke-is-born',
    number: 4,
    title: 'Sasuke is born',
    date: at(5, 7, 23, 16),
    place: 'Fugaku’s house in the Uchiha district, Hidden Leaf',
    locationKind: 'structure',
    cast: ['Itachi Uchiha', 'Mikoto Uchiha', 'Fugaku Uchiha', 'Sasuke Uchiha'],
    scene: 'The day Sasuke is born. Itachi becomes a big brother, and you watch him hold Sasuke for the first time.',
    castNotes: ['Sasuke is a newborn.', 'Itachi, five, is careful and amazed and trying not to show it.'],
    hint: 'Sasuke in the scene, Itachi talking about his brother, Sasuke’s birthday, a newborn crying',
    triggers: {
      people: ['Sasuke Uchiha'],
      dates: [{ month: 7, day: 23 }],
      words: /\b(sasuke|little brother|baby brother)\b/i,
    },
    fixed: ['Sasuke is born healthy today.'],
    memoryLine: 'The day Sasuke was born, and Itachi held his brother for the first time.',
    importance: 3,
  },
  {
    id: 'nine-tails-night',
    number: 5,
    title: 'The Nine-Tails night',
    date: at(5, 10, 10, 21, 40),
    place: 'the Hidden Leaf, the night the Nine-Tails attacks',
    locationKind: 'settlement',
    cast: ['Erisa Uchiha', 'Banri Uzumaki'],
    scene:
      'The night the Nine-Tails attacks the Leaf. The village burns and shakes, and you lose Erisa and Banri. The heaviest memory you have.',
    hint: 'the anniversary of that night, an orange glow, the Nine-Tails’ chakra, Naruto, the smell of a village burning',
    triggers: {
      dates: [{ month: 10, day: 10 }],
      people: ['Naruto Uzumaki'],
      words: /\b(nine[- ]tails|nine[- ]tailed|kyūbi|kyuubi|kyubi|kurama|tailed beast|jinch[uū]riki)\b/i,
    },
    fixed: [
      'Erisa and Banri die tonight; you survive.',
      'The Fourth Hokage stops the beast tonight and dies doing it.',
    ],
    hidden: [
      'where the Nine-Tails was sealed, or that a baby holds it',
      'who Naruto’s parents are',
      'the masked man behind the attack',
    ],
    memoryLine: 'The night the Nine-Tails attacked the Leaf, and you lost your mother and father.',
    importance: 5,
  },

  // ---------------------------------------------------------------------
  // The Academy and Team 3
  {
    id: 'the-academy',
    number: 6,
    title: 'The Academy',
    date: at(6, 4, 7, 8, 30),
    place: 'the Ninja Academy, Hidden Leaf',
    locationKind: 'structure',
    cast: ['Itachi Uchiha', 'Izumi Uchiha', 'Hana Inuzuka'],
    scene: 'Your first day at the Academy. Izumi looks at Itachi, and you are the first to notice.',
    castNotes: [
      'Izumi, shy, lost her father in the Nine-Tails attack and is looked at sideways for being Uchiha.',
      'Hana is loud and already has a puppy at home she won’t stop talking about.',
    ],
    hint: 'Izumi’s name, Izumi’s grave, Hana talking about her, a schoolyard, Izumi’s birthday',
    triggers: {
      dates: [{ month: 8, day: 14 }],
      words: /\b(izumi|the academy|academy days|schoolyard)\b/i,
    },
    fixed: ['Izumi’s feelings for Itachi start here; she never says them aloud today.'],
    memoryLine: 'Your first day at the Academy, and the moment you saw Izumi look at Itachi.',
    importance: 3,
  },
  {
    id: 'itachi-leaves-them-behind',
    number: 7,
    title: 'Itachi leaves them behind',
    date: at(7, 11, 2, 11),
    place: 'the Ninja Academy yard, Hidden Leaf',
    locationKind: 'settlement',
    cast: ['Itachi Uchiha', 'Izumi Uchiha', 'Hana Inuzuka', 'Fugaku Uchiha'],
    scene:
      'Itachi graduates at seven, top of his class, after a single year. You stay behind in the Academy; you will graduate two years later, at nine.',
    hint: 'someone praising Itachi, being compared with Itachi, a prodigy, standing in someone’s shadow',
    triggers: {
      words: /\b(prodigy|genius|in (his|itachi'?s) shadow|compared? (you )?(to|with) itachi|just like itachi|better than itachi|itachi'?s little shadow)\b/i,
    },
    fixed: ['Itachi graduates today; you do not.', 'You graduate in Year 9.'],
    memoryLine: 'The day Itachi graduated at seven and left you behind in the Academy.',
    importance: 3,
  },
  {
    id: 'team-three',
    number: 8,
    title: 'Team 3',
    date: at(9, 9, 20, 9),
    place: 'a training ground in the Hidden Leaf',
    locationKind: 'wilderness',
    cast: ['Hana Inuzuka', 'Izumi Uchiha', 'Suzume'],
    scene:
      'You graduate at nine, and you, Hana and Izumi meet Suzume as your sensei on a training ground for the first time: Team 3.',
    castNotes: ['Suzume is younger and sharper than she will be, testing whether the three of you are worth teaching.'],
    hint: 'Suzume in the scene, your old forehead protector, a training ground, Suzume’s birthday',
    triggers: {
      people: ['Suzume'],
      dates: [{ month: 10, day: 19 }],
      words: /\b(forehead protector|headband|team 3|team three|suzume)\b/i,
    },
    fixed: ['Team 3 is formed today, and Suzume keeps you.'],
    memoryLine: 'The day Team 3 was formed: you, Hana and Izumi, and Suzume as your sensei.',
    importance: 4,
  },
  {
    id: 'hanas-dogs',
    number: 9,
    title: 'Hana’s dogs',
    date: at(10, 8, 3, 7, 30),
    place: 'the forests of the Land of Fire, on a Team 3 mission',
    locationKind: 'wilderness',
    cast: ['Hana Inuzuka', 'Izumi Uchiha', 'Suzume'],
    scene: 'A Team 3 mission with Hana and her three ninken, the Haimaru brothers, tracking something through the forest.',
    castNotes: ['The Haimaru brothers are three young grey ninken, Hana’s and devoted to her.'],
    hint: 'Hana in the scene, a dog barking, ninken, a scent trail, the Inuzuka compound',
    triggers: {
      people: ['Hana Inuzuka'],
      places: { words: /\binuzuka\b/i },
      words: /\b(dogs?|ninken|hounds?|pupp(y|ies)|haimaru)\b/i,
    },
    fixed: ['Team 3 comes home from this mission together.'],
    memoryLine: 'A Team 3 mission with Hana and the Haimaru brothers in the forests of Fire.',
    importance: 3,
  },
  {
    id: 'itachis-eyes',
    number: 10,
    title: 'Itachi’s eyes',
    date: at(8, 12, 3, 20),
    place: 'the Naka Shrine grounds in the Uchiha district, Hidden Leaf',
    locationKind: 'settlement',
    cast: ['Itachi Uchiha'],
    scene:
      'Itachi, eight, has just awakened his Sharingan: days ago his teammate Tenma Izumo was killed in front of him, on a mission guarding the Fire Daimyō. He shows you his eyes. You have no Sharingan yet.',
    hint: 'your own eyes aching, a talk about the Sharingan, red eyes in the dark',
    triggers: {
      beats: ['kan-sight-strain', 'kan-sight-fades'],
      words: /\b(sharingan|tomoe|your eyes|his eyes|mangeky[oō])\b/i,
    },
    fixed: ['Itachi has the Sharingan; you do not.', 'Tenma Izumo is dead.'],
    hidden: ['anything about who killed Tenma, or the killer’s eye'],
    memoryLine: 'The night Itachi showed you the Sharingan he woke after Tenma Izumo died.',
    importance: 4,
  },

  // ---------------------------------------------------------------------
  // The ANBU years
  {
    id: 'itachi-joins-anbu',
    number: 11,
    title: 'Itachi joins ANBU',
    date: at(11, 8, 12, 19),
    place: 'the rooftops of the Uchiha district, Hidden Leaf',
    locationKind: 'settlement',
    cast: ['Itachi Uchiha'],
    scene:
      'Itachi, eleven, joins ANBU, the youngest it has ever taken, in Kakashi’s unit. He tells you on a rooftop, mask in his hand. You are still a genin on Team 3, and you will be left behind for a year.',
    hint: 'Kakashi in the scene, ANBU masks, Yūgao, rooftops at night',
    triggers: {
      people: ['Kakashi Hatake', 'Yūgao Uzuki'],
      words: /\banbu\b/i,
    },
    fixed: ['Itachi joins ANBU under Kakashi; you join a year later.'],
    hidden: ['the coup, or anything Itachi is asked to watch in his clan'],
    memoryLine: 'The night Itachi told you he had joined ANBU, and you were left behind for a year.',
    importance: 3,
  },
  {
    id: 'the-mask',
    number: 12,
    title: 'The mask',
    date: at(12, 7, 15, 17),
    place: 'ANBU headquarters, then the Team 3 training ground, Hidden Leaf',
    locationKind: 'structure',
    cast: ['Hana Inuzuka', 'Izumi Uchiha', 'Suzume', 'Danzo Shimura'],
    scene:
      'You join ANBU and leave Team 3 for good: the mask, the oath, saying goodbye to Hana, Izumi and Suzume. Danzō is somewhere in the background, watching.',
    castNotes: ['Danzō is only a presence at the edge of the room: he says little, and his attention is the point.'],
    hint: 'an ANBU mask, Root, Danzō, an oath, someone who never takes off his mask',
    triggers: {
      people: ['Danzo Shimura'],
      beats: ['root-hunter', 'root-hunter-returns', 'kan-danzo'],
      words: /\b(anbu mask|root|danz[oō]|oath)\b/i,
    },
    fixed: ['You join ANBU today and leave Team 3 for good.'],
    hidden: ['what Danzō will do to Shisui, or Root’s plans'],
    memoryLine: 'The day you put on the ANBU mask and said goodbye to Team 3.',
    importance: 4,
  },
  {
    id: 'first-kill',
    number: 13,
    title: 'First kill',
    date: at(12, 9, 3, 2, 10),
    place: 'a pine forest on the Land of Fire’s northern border, on an ANBU mission',
    locationKind: 'wilderness',
    cast: [],
    scene: 'An ANBU mission at night with your unit, and the first life you take.',
    castNotes: ['Your ANBU unit are masked squadmates with code names; invent them sparingly.'],
    hint: 'blood on your hands, a body at your feet, the quiet after a kill',
    triggers: {
      afterFight: true,
      words: /\b(killed|kills?|corpse|body|bodies|blood on your hands|took (a|his|her|their) life|dead (man|woman|ninja|shinobi))\b/i,
    },
    fixed: ['You kill someone on this mission and come home alive.'],
    memoryLine: 'The ANBU mission on the northern border where you took a life for the first time.',
    importance: 4,
  },
  {
    id: 'shisui-of-the-body-flicker',
    number: 14,
    title: 'Shisui of the Body Flicker',
    date: at(12, 4, 9, 6, 30),
    place: 'a training ground in the forest outside the Uchiha district, Hidden Leaf',
    locationKind: 'wilderness',
    cast: ['Shisui Uchiha', 'Itachi Uchiha'],
    scene: 'Shisui trains you and Itachi at dawn, and you see why the world calls him Shisui of the Body Flicker.',
    castNotes: ['Shisui, fifteen, is famous already and wears it lightly.'],
    hint: 'a Body Flicker, Shisui’s eye, Danzō, someone moving faster than the eye can follow',
    triggers: {
      beats: ['shisui-eye-trail', 'shisui-eye-danzo', 'shisui-eye-iron'],
      people: ['Danzo Shimura'],
      words: /\b(body flicker|shunshin|shisui)\b/i,
    },
    fixed: ['Shisui is the fastest of the three of you by far.'],
    hidden: [NO_SHISUI_TRUTH],
    memoryLine: 'A dawn on the training ground when Shisui showed you why they call him Shisui of the Body Flicker.',
    importance: 3,
  },

  // ---------------------------------------------------------------------
  // The last days (year 13)
  {
    id: 'last-good-day',
    number: 15,
    title: 'The last good day',
    date: at(13, 9, 14, 15),
    place: 'the banks of the Naka River, Hidden Leaf',
    locationKind: 'wilderness',
    cast: ['Itachi Uchiha', 'Shisui Uchiha'],
    scene: 'The three of you at the Naka River on an afternoon off, before everything breaks.',
    castNotes: ['Shisui is tired in a way he hides well.', 'Itachi is quieter than he used to be.'],
    hint: 'the Naka River, running water like it, Shisui’s eye, Itachi’s death',
    triggers: {
      places: { ids: ['naka-river'], words: /\bnaka river\b/i },
      beats: ['itachi-vs-sasuke', 'shisui-truth', 'shisui-eye-trail', 'shisui-eye-danzo'],
      words: /\b(naka river|shisui'?s eyes?)\b/i,
    },
    fixed: ['Nothing breaks today: it is a good, ordinary afternoon.'],
    hidden: [NO_SHISUI_TRUTH, 'the coup'],
    memoryLine: 'The last good day: you, Itachi and Shisui at the Naka River before everything broke.',
    importance: 4,
  },
  {
    id: 'shisuis-last-night',
    number: 16,
    title: 'Shisui’s last night',
    date: at(13, 9, 20, 20),
    place: 'near the Naka Shrine, Hidden Leaf',
    locationKind: 'settlement',
    cast: ['Shisui Uchiha'],
    scene: 'You see Shisui one last time, the night he dies, and something feels wrong.',
    hint: 'the truth about Shisui, the Naka Shrine, a goodbye that didn’t sound like one',
    triggers: {
      beats: ['shisui-truth'],
      words: /\b(shisui)\b/i,
    },
    requires: ['shisui-truth'],
    fixed: [
      'Shisui dies tonight in the Naka River, after he leaves you.',
      'You learn nothing true tonight: Shisui does not tell you about Danzō, his eyes or the coup.',
    ],
    hidden: ['what Danzō did to Shisui tonight', 'where Shisui goes after he leaves you'],
    memoryLine: 'The last time you saw Shisui, the night he died, and the feeling that something was wrong.',
    importance: 5,
  },
  {
    id: 'the-week-before',
    number: 17,
    title: 'The week before',
    date: at(13, 9, 24, 14),
    place: 'a dango shop in the Hidden Leaf',
    locationKind: 'structure',
    cast: ['Hana Inuzuka', 'Izumi Uchiha'],
    scene:
      'Not a Team 3 day: you have been in ANBU for over a year. You meet Hana and Izumi off duty, the three of you like old times for one afternoon: the last ordinary one.',
    hint: 'Izumi’s grave, Hana at the grave, dango, an afternoon off',
    triggers: {
      beats: ['izumi-grave', 'izumi-funeral'],
      words: /\b(izumi'?s grave|dango)\b/i,
    },
    fixed: ['It is an ordinary afternoon; Izumi is alive and nobody knows what is coming.'],
    hidden: ['the coup, and the massacre that is coming'],
    memoryLine: 'The last ordinary afternoon with Hana and Izumi, a week before the massacre.',
    importance: 4,
  },
  {
    id: 'the-fight',
    number: 18,
    title: 'The fight',
    date: at(13, 9, 27, 23),
    place: 'a training ground in the forest outside the Hidden Leaf',
    locationKind: 'wilderness',
    cast: ['Itachi Uchiha'],
    scene:
      'Days before the massacre. Itachi tells you what he is going to do; you fight him, you hold back, and you lose. He sends you to hide in the forest and wait.',
    hint: 'fighting Itachi again, Itachi’s death, the massacre anniversary, the forest where you waited',
    triggers: {
      dates: [{ month: 10, day: 1 }],
      people: ['Itachi Uchiha'],
      afterFight: true,
      beats: ['itachi-vs-sasuke'],
      words: /\b(massacre|that night)\b/i,
    },
    fixed: [
      'Itachi tells you he will kill the clan; you fight; you hold back and lose.',
      'Itachi sends you to the forest to hide and wait.',
    ],
    hidden: [
      'why Itachi does it: the coup, the order, Danzō, Shisui’s truth',
      'how strong you really are: never show the limit of your power',
    ],
    memoryLine: 'The night Itachi told you what he would do, and you fought him, held back, and lost.',
    importance: 5,
  },
];

export const FLASHBACK_BY_ID: Record<string, FlashbackRecord> = Object.fromEntries(
  FLASHBACKS.map((record) => [record.id, record])
);

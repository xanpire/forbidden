// Data for the yearly calendar (see yearly.ts): how people treat their
// birthdays, and the festivals of each village. Pure data.

/**
 * How someone treats their own birthday:
 * - announces: tells everyone ("It's my birthday today, after all!")
 * - hides: never mentions it; someone else has to know
 * - hates: would rather the day passed unnoticed, and says so
 * - ritual: marks it in their own way
 * - quiet: lets it pass unless asked (everyone not listed)
 */
export type BirthdayHabitKind = 'announces' | 'hides' | 'hates' | 'ritual' | 'quiet';

export type BirthdayHabit = { kind: BirthdayHabitKind; note: string };

export const BIRTHDAY_HABITS: Record<string, BirthdayHabit> = {
  'Itachi Uchiha': { kind: 'hides', note: 'never mentions it; a quiet word from someone who remembers means more to him than he shows' },
  'Hana Inuzuka': { kind: 'announces', note: 'expects her friends to remember and lets them know if they forget; the dogs get cake too' },
  'Izumi Uchiha': { kind: 'quiet', note: 'never asked for anything, and lit up when someone remembered' },
  Suzume: { kind: 'hides', note: 'pretends the day is ordinary; her old students knowing is the only gift she wants' },
  'Shisui Uchiha': { kind: 'quiet', note: 'laughed it off and spent it with Itachi and Kan' },
  'Naruto Uzumaki': { kind: 'announces', note: '"It\'s my birthday today, after all!" — though for years nobody celebrated it, because it is also the day the Nine-Tails attacked' },
  'Sasuke Uchiha': { kind: 'hates', note: 'since the massacre there has been no one to celebrate it with, and he wants no one to try' },
  'Sakura Haruno': { kind: 'announces', note: 'drops hints for weeks, especially within earshot of Sasuke' },
  'Kakashi Hatake': { kind: 'hides', note: 'spends it at the memorial stone, if he is in the village' },
  'Might Guy': { kind: 'ritual', note: 'New Year\'s Day; he celebrates with a challenge of youth, usually aimed at Kakashi' },
  'Rock Lee': { kind: 'announces', note: 'treats it as a day to train twice as hard and wants everyone to join' },
  'Jiraiya': { kind: 'announces', note: 'an excuse for a drink and an hour at the bathhouse "for research"' },
  'Tsunade Senju': { kind: 'hates', note: 'another year older, drowned in sake and bad bets' },
  'Shikamaru Nara': { kind: 'quiet', note: 'a drag; he would rather nap' },
  'Choji Akimichi': { kind: 'announces', note: 'all-you-can-eat barbecue, no exceptions' },
  'Ino Yamanaka': { kind: 'announces', note: 'flowers from her own shop, and opinions about yours' },
  'Hinata Hyuga': { kind: 'quiet', note: 'too shy to say a word, and moved to tears if someone remembers' },
  'Kiba Inuzuka': { kind: 'announces', note: 'shares it with Akamaru and shouts about it' },
  'Gaara': { kind: 'hates', note: 'his birthday was the day his mother died; in Part I it is just another reason to kill, later a day he spends quietly' },
  'Temari': { kind: 'hides', note: 'thinks birthdays are for children, and is secretly pleased when remembered' },
  'Kankuro': { kind: 'announces', note: 'shares it with Killer Bee and finds that annoying' },
  'Konohamaru Sarutobi': { kind: 'announces', note: 'demands to be treated like a Hokage for a day' },
  'Iruka Umino': { kind: 'quiet', note: 'buys ramen for whoever is around' },
  'Anko Mitarashi': { kind: 'ritual', note: 'dumplings, too many of them, and she counts the skewers' },
  'Kisame Hoshigaki': { kind: 'hates', note: 'finds the whole idea of birthdays funny, his own most of all' },
  'Deidara': { kind: 'ritual', note: 'wants it to go off with a bang, literally' },
  'Sasori': { kind: 'hates', note: 'does not see the point: he does not age' },
  'Kakuzu': { kind: 'hates', note: 'asks what it costs, and whether anyone is paying' },
  'Hidan': { kind: 'ritual', note: 'makes it a ritual to Jashin, with someone else\'s blood' },
  'Konan': { kind: 'hides', note: 'shares the day with Yahiko and keeps it to herself; paper flowers appear' },
  'Pain': { kind: 'hides', note: 'a god has no birthday' },
  'Tobi': { kind: 'hides', note: 'the man under the mask has no birthday anyone may know' },
  'Zetsu': { kind: 'hides', note: 'does not understand the question' },
  'Orochimaru': { kind: 'quiet', note: 'one more year he intends to outlive' },
  'Kabuto Yakushi': { kind: 'hides', note: 'a leap-day birthday for a man without a self; he keeps it on the twenty-eighth when there is no twenty-ninth' },
  'Karin': { kind: 'quiet', note: 'nobody ever celebrated it in the Grass, so she pretends not to care' },
  'Suigetsu Hozuki': { kind: 'announces', note: 'expects presents and complains about them' },
  'Jugo': { kind: 'quiet', note: 'grateful if anyone remembers; birds come' },
  'Killer Bee': { kind: 'announces', note: 'raps about it, shares it with Kankurō, and makes it an event' },
  'Mei Terumi': { kind: 'hates', note: 'the topic of her age is dangerous; mention it carefully' },
  'Hiruzen Sarutobi': { kind: 'quiet', note: 'a pipe and a quiet hour with his grandson' },
  'Danzo Shimura': { kind: 'hides', note: 'a man of the shadows has no birthday' },
  'Shino Aburame': { kind: 'announces', note: 'announces it in a long, logical statement, and is hurt when people forget' },
  'Neji Hyuga': { kind: 'hides', note: 'shares the season with his father\'s memory and says nothing' },
  'Tenten': { kind: 'quiet', note: 'would like a good weapon as a present, thank you' },
  'Sai': { kind: 'quiet', note: 'read in a book that birthdays matter and is still working out why' },
  'Kurenai Yuhi': { kind: 'quiet', note: 'Asuma always remembered' },
  'Asuma Sarutobi': { kind: 'quiet', note: 'a cigarette and a game of shogi with Shikamaru' },
  'Fū': { kind: 'announces', note: 'desperate for anyone to celebrate it with her' },
  'Yugito Nii': { kind: 'hides', note: 'keeps her distance, even on her day' },
  'Hanabi Hyuga': { kind: 'announces', note: 'shares it with her nephew Boruto, eventually' },
  'Teuchi': { kind: 'ritual', note: 'a free bowl of ramen for regulars' },
  'Ayame': { kind: 'quiet', note: 'works the stall anyway' },
};

/**
 * A yearly date that is not a birthday: an anniversary the whole world (or a
 * village) keeps, or a festival. Festivals only come up when Kan is in or
 * near their place (`where` matches the location). `invented` marks the
 * ones the series never shows; the rest are canon.
 */
export type YearlyFestival = {
  id: string;
  name: string;
  /** Words matched against Kan's location (case-insensitive). */
  where: string[];
  month: number;
  day: number;
  /** How many days it runs (default 1). */
  days?: number;
  note: string;
  invented?: boolean;
  /** Held only once this milestone has happened. */
  from?: string;
  /** Held only quietly, or not at all, until this milestone has happened. */
  quietUntil?: string;
};

const LEAF = ['hidden leaf', 'konoha', 'land of fire'];
const SAND = ['hidden sand', 'suna', 'land of wind'];
const MIST = ['hidden mist', 'kiri', 'land of water'];
const CLOUD = ['hidden cloud', 'kumo', 'land of lightning'];
const STONE = ['hidden stone', 'iwa', 'land of earth'];
const RAIN = ['hidden rain', 'amegakure', 'land of rain'];
const WAVES = ['land of waves', 'great naruto bridge'];

export const FESTIVALS: YearlyFestival[] = [
  // Hidden Leaf
  {
    id: 'rinne-festival',
    name: 'the Rinne Festival',
    where: LEAF,
    month: 12,
    day: 20,
    days: 5,
    note: 'the Leaf’s winter festival: once a time to pray for the dead, now lanterns, stalls and hand-made gifts (a knitted scarf is the classic) for the people you love',
  },
  {
    id: 'leaf-lantern-night',
    name: 'the lantern night',
    where: LEAF,
    month: 8,
    day: 13,
    days: 3,
    note: 'paper lanterns floated down the river for the dead of every war, and summer fireworks over the Hokage Rock',
    invented: true,
  },
  {
    id: 'leaf-founding-day',
    name: 'Founding Day',
    where: LEAF,
    month: 4,
    day: 3,
    note: 'the day Hashirama and Madara founded the village; academy children recite the Will of Fire and the Uchiha part of the story is told very briefly',
    invented: true,
  },
  // Hidden Sand
  {
    id: 'sand-wind-festival',
    name: 'the Wind Festival',
    where: SAND,
    month: 5,
    day: 10,
    days: 2,
    note: 'kites over the desert walls and puppet shows in the streets',
    invented: true,
  },
  {
    id: 'sand-night-of-dunes',
    name: 'the Night of the Dunes',
    where: SAND,
    month: 10,
    day: 22,
    note: 'when the heat breaks: fires on the dunes, music, and water shared freely for one night',
    invented: true,
  },
  // Hidden Mist
  {
    id: 'mist-tide-lanterns',
    name: 'the Tide Lantern Festival',
    where: MIST,
    month: 7,
    day: 7,
    days: 2,
    note: 'lanterns set out on the outgoing tide for those lost at sea and in the Mist’s wars',
    invented: true,
    quietUntil: 'mei-mizukage',
  },
  {
    id: 'mist-clearing',
    name: 'the Clearing',
    where: MIST,
    month: 3,
    day: 21,
    note: 'the one spring morning the mist is said to lift: sailors bless their boats',
    invented: true,
    quietUntil: 'mei-mizukage',
  },
  // Hidden Cloud
  {
    id: 'cloud-thunder-drums',
    name: 'the Thunder Drum Festival',
    where: CLOUD,
    month: 6,
    day: 15,
    days: 2,
    note: 'drummers on the cliffs answering the summer storms; arm-wrestling contests the Raikage is never allowed to enter',
    invented: true,
  },
  {
    id: 'cloud-storm-blessing',
    name: 'the Storm Blessing',
    where: CLOUD,
    month: 11,
    day: 1,
    note: 'the first winter storm, greeted with sake on the high bridges',
    invented: true,
  },
  // Hidden Stone
  {
    id: 'stone-lifting',
    name: 'the Stone-Lifting Festival',
    where: STONE,
    month: 9,
    day: 15,
    days: 2,
    note: 'boulders lifted in the square and old men complaining about their backs',
    invented: true,
  },
  {
    id: 'stone-mountain-lanterns',
    name: 'the Mountain Lanterns',
    where: STONE,
    month: 1,
    day: 15,
    note: 'lanterns set in the cliffs above the village for the ancestors',
    invented: true,
  },
  // Hidden Rain
  {
    id: 'rain-paper-flowers',
    name: 'Paper Flower Day',
    where: RAIN,
    month: 2,
    day: 20,
    note: 'the Rain’s people leave paper flowers for their "angel" on her day (Konan’s birthday, though they do not know it)',
    invented: true,
    from: 'ame-stronghold',
  },
  {
    id: 'rain-night-no-lamps',
    name: 'the Night of No Lamps',
    where: RAIN,
    month: 11,
    day: 30,
    note: 'one night of darkness for the dead of the wars fought on Rain soil, kept since before Hanzō',
    invented: true,
  },
  // Land of Waves
  {
    id: 'waves-bridge-day',
    name: 'Bridge Day',
    where: WAVES,
    month: 11,
    day: 15,
    note: 'the islanders celebrate the bridge that freed them from Gatō, and the boy it was named after',
    invented: true,
    from: 'land-of-waves',
  },
];

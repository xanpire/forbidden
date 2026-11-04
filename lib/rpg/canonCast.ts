import { loreProfileFor } from './romance';
import type { EntityRecord } from './types';

/**
 * The main canon cast, loaded into every save from the start.
 *
 * Each person exists exactly once, with the names the story is likely to use
 * for them, so the state tracker can refer to them by ID instead of inventing
 * a second "Kisame" or "Hoshigaki Kisame". Entries start with `met: false`:
 * they stay out of the bonds list until you actually meet them.
 *
 * Roles describe each person at the start of the story (year 13); later
 * changes — Kisame joining the Akatsuki, Tsunade becoming Hokage — come from
 * the story and the canon timeline.
 *
 * Years count from Kan's birth (year 0); the massacre is in year 13, when Kan
 * and Itachi are 13. Ages follow the databooks loosely, lined up so Naruto is
 * 12 at the Chunin Exams.
 *
 * Aliases avoid common words ("Leader", "Guy", "Bee"): names are also matched
 * as whole words inside longer names, and "the guy with the scar" must not
 * become Might Guy.
 *
 * The real Madara Uchiha is deliberately absent: until he appears, a bare
 * "Madara" belongs to the masked man, who claims that name.
 */
type CastEntry = {
  name: string;
  aliases: string[];
  birthday: { month: number; day: number };
  birthYear: number;
  role: string;
  personality: string;
  speechStyle: string;
  appearance: string;
  /** Status at the start of the story, when it is not simply alive. */
  status?: string;
  tags: string[];
};

export const CANON_CAST: CastEntry[] = [
  {
    name: 'Sasuke Uchiha',
    aliases: ['Sasuke', 'Uchiha Sasuke'],
    birthday: { month: 7, day: 23 },
    birthYear: 5,
    role: 'Itachi’s little brother',
    personality: 'Proud, intense, lonely; lives for avenging his clan.',
    speechStyle: 'Curt, cold, dismissive.',
    appearance: 'Dark spiky hair swept back, black eyes, high-collared shirt with the Uchiha crest.',
    tags: ['canon', 'uchiha', 'leaf'],
  },
  {
    name: 'Naruto Uzumaki',
    aliases: ['Naruto', 'Uzumaki Naruto'],
    birthday: { month: 10, day: 10 },
    birthYear: 5,
    role: 'Leaf orphan · Nine-Tails jinchuriki',
    personality: 'Loud, stubborn, warm, never gives up.',
    speechStyle: 'Brash and energetic, ends sentences with "dattebayo".',
    appearance: 'Spiky blond hair, blue eyes, whisker marks, bright orange jumpsuit.',
    tags: ['canon', 'uzumaki', 'leaf', 'jinchuriki'],
  },
  {
    name: 'Sakura Haruno',
    aliases: ['Sakura', 'Haruno Sakura'],
    birthday: { month: 3, day: 28 },
    birthYear: 5,
    role: 'Leaf kunoichi',
    personality: 'Bright, short-tempered, determined to prove herself.',
    speechStyle: 'Sharp and expressive.',
    appearance: 'Pink hair, green eyes, broad forehead, red qipao-style top.',
    tags: ['canon', 'leaf'],
  },
  {
    name: 'Kakashi Hatake',
    aliases: ['Kakashi', 'Hatake Kakashi', 'Copy Ninja Kakashi'],
    birthday: { month: 9, day: 15 },
    birthYear: -9,
    role: 'Leaf jonin · former ANBU',
    personality: 'Laid-back on the surface, sharp and grieving underneath.',
    speechStyle: 'Lazy, dry, mildly teasing.',
    appearance: 'Spiky silver hair, mask over the lower face, headband over his left Sharingan eye.',
    tags: ['canon', 'leaf', 'anbu'],
  },
  {
    name: 'Hiruzen Sarutobi',
    aliases: ['Hiruzen', 'Third Hokage', 'Lord Third', 'Sarutobi Hiruzen'],
    birthday: { month: 2, day: 8 },
    birthYear: -51,
    role: 'Third Hokage',
    personality: 'Wise, gentle, burdened by the compromises of leading.',
    speechStyle: 'Grandfatherly, patient, measured.',
    appearance: 'Elderly man with a goatee and pipe, wearing the white-and-red Hokage robes.',
    tags: ['canon', 'leaf', 'hokage'],
  },
  {
    name: 'Danzo Shimura',
    aliases: ['Danzo', 'Shimura Danzo'],
    birthday: { month: 1, day: 3 },
    birthYear: -50,
    role: 'Leaf elder · head of Root',
    personality: 'Ruthless, cold, convinced the village survives only through darkness.',
    speechStyle: 'Flat, clipped, commanding.',
    appearance: 'Old man with bandages over his right eye, an X-shaped chin scar, and a cane.',
    tags: ['canon', 'leaf', 'root'],
  },
  {
    name: 'Jiraiya',
    aliases: ['Jiraiya-sama', 'Toad Sage', 'Pervy Sage'],
    birthday: { month: 11, day: 11 },
    birthYear: -33,
    role: 'Legendary Sannin · spymaster',
    personality: 'Boisterous and lecherous, perceptive and kind beneath it.',
    speechStyle: 'Theatrical, boastful, suddenly serious.',
    appearance: 'Tall man with long spiky white hair, red lines under his eyes, and a horned headband.',
    tags: ['canon', 'leaf', 'sannin'],
  },
  {
    name: 'Tsunade Senju',
    aliases: ['Tsunade', 'Lady Tsunade', 'Fifth Hokage'],
    birthday: { month: 8, day: 2 },
    birthYear: -33,
    role: 'Legendary Sannin · medical ninja',
    personality: 'Fierce, proud, grieving, a reckless gambler.',
    speechStyle: 'Blunt and commanding.',
    appearance: 'Looks far younger than her age; blonde pigtails, a diamond mark on her forehead, green haori.',
    tags: ['canon', 'leaf', 'sannin', 'senju'],
  },
  {
    name: 'Orochimaru',
    aliases: ['Orochimaru-sama', 'Lord Orochimaru'],
    birthday: { month: 10, day: 27 },
    birthYear: -33,
    role: 'Legendary Sannin · rogue scientist',
    personality: 'Curious, patient, chillingly amoral; collects talent.',
    speechStyle: 'Silky, amused, unhurried.',
    appearance: 'Pale skin, long black hair, golden snake-like eyes, purple eye markings.',
    tags: ['canon', 'sannin', 'rogue'],
  },
  {
    name: 'Kabuto Yakushi',
    aliases: ['Kabuto', 'Yakushi Kabuto'],
    birthday: { month: 2, day: 29 },
    birthYear: -2,
    role: 'Spy · Orochimaru’s right hand',
    personality: 'Polite mask over a hollow, shifting identity.',
    speechStyle: 'Courteous, mild, quietly mocking.',
    appearance: 'Silver hair in a ponytail, round glasses, purple shinobi clothes.',
    tags: ['canon', 'rogue'],
  },
  {
    name: 'Shisui Uchiha',
    aliases: ['Shisui', 'Shisui of the Body Flicker'],
    birthday: { month: 10, day: 19 },
    birthYear: -3,
    role: 'Leaf jonin · Uchiha',
    personality: 'Gentle, selfless, devoted to peace.',
    speechStyle: 'Warm and easygoing.',
    appearance: 'Curly black hair, kind dark eyes, Leaf flak jacket.',
    status: 'Deceased',
    tags: ['canon', 'uchiha', 'leaf'],
  },
  {
    name: 'Kisame Hoshigaki',
    aliases: ['Kisame', 'Hoshigaki Kisame'],
    birthday: { month: 3, day: 18 },
    birthYear: -12,
    role: 'Mist swordsman · one of the Seven Swordsmen',
    personality: 'Bloodthirsty, jovial, surprisingly loyal to his partner.',
    speechStyle: 'Toothy, sardonic, chuckling.',
    appearance: 'Huge man with blue-grey skin, gill marks, shark teeth, and the bandaged sword Samehada.',
    tags: ['canon', 'akatsuki', 'mist'],
  },
  {
    name: 'Kakuzu',
    aliases: ['Kakuzu of the Waterfall'],
    birthday: { month: 8, day: 15 },
    birthYear: -71,
    role: 'Akatsuki · treasurer',
    personality: 'Greedy, short-tempered, coldly practical.',
    speechStyle: 'Gruff and impatient.',
    appearance: 'Tall masked man with green-on-red eyes, a dark hood, and stitched dark skin.',
    tags: ['canon', 'akatsuki', 'waterfall'],
  },
  {
    name: 'Hidan',
    aliases: ['Hidan of the Hot Springs'],
    birthday: { month: 4, day: 2 },
    birthYear: -2,
    role: 'Jashinist from the Hot Springs Village',
    personality: 'Fanatical, crude, immortal, relishes pain.',
    speechStyle: 'Loud and foul-mouthed.',
    appearance: 'Slicked-back silver hair, violet eyes, a three-bladed scythe, and a Jashin pendant.',
    tags: ['canon', 'akatsuki'],
  },
  {
    name: 'Deidara',
    aliases: ['Deidara of the Stone'],
    birthday: { month: 5, day: 5 },
    birthYear: 1,
    role: 'Stone ninja · explosives artist',
    personality: 'Arrogant, hot-headed, obsessed with art as an explosion.',
    speechStyle: 'Cocky, ends sentences with "un" or "hm".',
    appearance: 'Long blond hair in a half ponytail covering one eye, a scope over the other, mouths on his palms.',
    tags: ['canon', 'akatsuki', 'stone'],
  },
  {
    name: 'Sasori',
    aliases: ['Sasori of the Red Sand', 'Hiruko'],
    birthday: { month: 11, day: 8 },
    birthYear: -15,
    role: 'Akatsuki · puppet master',
    personality: 'Impatient, cold, sees people as puppets.',
    speechStyle: 'Terse and irritable.',
    appearance: 'Usually hidden inside the hunched puppet Hiruko; really a red-haired youth of eternal age.',
    tags: ['canon', 'akatsuki', 'sand'],
  },
  {
    name: 'Konan',
    aliases: ['Angel of the Rain'],
    birthday: { month: 2, day: 20 },
    birthYear: -15,
    role: 'Akatsuki · Pain’s partner',
    personality: 'Calm, distant, devoted to Nagato.',
    speechStyle: 'Quiet and economical.',
    appearance: 'Short blue hair with a paper flower, amber eyes, a lip piercing.',
    tags: ['canon', 'akatsuki', 'rain'],
  },
  {
    name: 'Pain',
    aliases: ['Nagato', 'Nagato Uzumaki', 'Six Paths of Pain'],
    birthday: { month: 9, day: 19 },
    birthYear: -15,
    role: 'Akatsuki leader',
    personality: 'Cold, godlike, convinced pain brings peace.',
    speechStyle: 'Solemn and absolute.',
    appearance: 'Orange-haired man pierced with black rods, ringed purple Rinnegan eyes.',
    tags: ['canon', 'akatsuki', 'rain'],
  },
  {
    name: 'Masked man',
    aliases: ['Tobi', 'Obito Uchiha', 'Obito'],
    birthday: { month: 2, day: 10 },
    birthYear: -9,
    role: 'Akatsuki’s hidden hand',
    personality: 'Secretive and manipulative; hides his true self.',
    speechStyle: 'Low and controlled; later playful as Tobi.',
    appearance: 'Black cloak, an orange swirl mask with one eyehole showing a Sharingan.',
    tags: ['canon', 'akatsuki', 'uchiha'],
  },
  {
    name: 'Zetsu',
    aliases: ['Black Zetsu', 'White Zetsu'],
    birthday: { month: 1, day: 1 },
    birthYear: -30,
    role: 'Akatsuki · spy',
    personality: 'Two voices in one body: one cheerful, one cold.',
    speechStyle: 'Alternates between a light and a deep voice.',
    appearance: 'Plant-like Venus flytrap leaves around a half-black, half-white face.',
    tags: ['canon', 'akatsuki'],
  },
  {
    name: 'Gaara',
    aliases: ['Gaara of the Desert', 'Gaara of the Sand'],
    birthday: { month: 1, day: 19 },
    birthYear: 5,
    role: 'Sand · One-Tail jinchuriki',
    personality: 'Isolated and dangerous; slowly learns to care.',
    speechStyle: 'Flat and quiet.',
    appearance: 'Short red hair, dark-rimmed eyes, the kanji for love on his forehead, a gourd of sand.',
    tags: ['canon', 'sand', 'jinchuriki'],
  },
  {
    name: 'Killer Bee',
    aliases: ['Killer B'],
    birthday: { month: 6, day: 23 },
    birthYear: -18,
    role: 'Cloud shinobi · Eight-Tails jinchuriki',
    personality: 'Carefree, confident, fiercely loyal to his brother.',
    speechStyle: 'Raps in bad rhymes.',
    appearance: 'Muscular dark-skinned man with sunglasses, a bull-horn tattoo, and seven swords.',
    tags: ['canon', 'cloud', 'jinchuriki'],
  },
  {
    name: 'Might Guy',
    aliases: ['Might Gai', 'Guy-sensei'],
    birthday: { month: 1, day: 1 },
    birthYear: -9,
    role: 'Leaf jonin · taijutsu master',
    personality: 'Passionate, endlessly upbeat, Kakashi’s self-declared rival.',
    speechStyle: 'Loud, preaches the springtime of youth.',
    appearance: 'Bowl haircut, thick eyebrows, green jumpsuit with orange leg warmers.',
    tags: ['canon', 'leaf'],
  },
  {
    name: 'Hinata Hyuga',
    aliases: ['Hinata', 'Hyuga Hinata'],
    birthday: { month: 12, day: 27 },
    birthYear: 5,
    role: 'Hyuga heiress',
    personality: 'Shy, kind, quietly brave.',
    speechStyle: 'Soft and hesitant.',
    appearance: 'Dark blue hair, pale lavender Byakugan eyes, oversized jacket.',
    tags: ['canon', 'leaf', 'hyuga'],
  },
  {
    name: 'Neji Hyuga',
    aliases: ['Neji', 'Hyuga Neji'],
    birthday: { month: 7, day: 3 },
    birthYear: 4,
    role: 'Hyuga branch house prodigy',
    personality: 'Proud, fatalistic, brilliant.',
    speechStyle: 'Cool and lecturing about fate.',
    appearance: 'Long dark hair, pale Byakugan eyes, a forehead protector hiding the caged-bird seal.',
    tags: ['canon', 'leaf', 'hyuga'],
  },
  {
    name: 'Shikamaru Nara',
    aliases: ['Shikamaru', 'Nara Shikamaru'],
    birthday: { month: 9, day: 22 },
    birthYear: 5,
    role: 'Nara clan strategist',
    personality: 'Lazy genius who cannot help solving things.',
    speechStyle: 'Bored sighs, "what a drag".',
    appearance: 'Black hair in a spiky ponytail, earrings, sleepy eyes.',
    tags: ['canon', 'leaf'],
  },
  {
    name: 'Kiba Inuzuka',
    aliases: ['Kiba', 'Inuzuka Kiba'],
    birthday: { month: 7, day: 7 },
    birthYear: 5,
    role: 'Hana’s little brother',
    personality: 'Brash, competitive, loyal.',
    speechStyle: 'Loud and cocky.',
    appearance: 'Messy brown hair, red fang marks on his cheeks, a puppy named Akamaru.',
    tags: ['canon', 'leaf', 'inuzuka'],
  },
  {
    name: 'Rock Lee',
    aliases: ['Lee'],
    birthday: { month: 11, day: 27 },
    birthYear: 4,
    role: 'Leaf · taijutsu specialist',
    personality: 'Earnest, hard-working, never quits.',
    speechStyle: 'Formal and passionate.',
    appearance: 'Bowl cut, huge round eyes, thick eyebrows, green jumpsuit like his sensei’s.',
    tags: ['canon', 'leaf'],
  },
  {
    name: 'Anko Mitarashi',
    aliases: ['Anko'],
    birthday: { month: 10, day: 27 },
    birthYear: -11,
    role: 'Leaf special jonin · Orochimaru’s former student',
    personality: 'Bold, wild, scarred by her old master.',
    speechStyle: 'Teasing and aggressive.',
    appearance: 'Purple hair in a short spiky ponytail, a mesh bodysuit and tan trench coat.',
    tags: ['canon', 'leaf'],
  },
  {
    name: 'Kurenai Yuhi',
    aliases: ['Kurenai'],
    birthday: { month: 6, day: 11 },
    birthYear: -9,
    role: 'Leaf jonin · genjutsu specialist',
    personality: 'Calm, caring, fiercely protective of her students.',
    speechStyle: 'Composed and warm.',
    appearance: 'Long wavy black hair, red eyes, a dress of wrapped bandage-like cloth.',
    tags: ['canon', 'leaf'],
  },
  {
    name: 'Asuma Sarutobi',
    aliases: ['Asuma'],
    birthday: { month: 10, day: 18 },
    birthYear: -10,
    role: 'Leaf jonin · son of the Third Hokage',
    personality: 'Laid-back, principled, protective.',
    speechStyle: 'Easygoing, through cigarette smoke.',
    appearance: 'Short dark hair, beard, cigarette, trench knives.',
    tags: ['canon', 'leaf'],
  },
  {
    name: 'Shizune',
    aliases: ['Shizune-san'],
    birthday: { month: 11, day: 18 },
    birthYear: -10,
    role: 'Medical ninja · Tsunade’s apprentice',
    personality: 'Earnest, worried, competent.',
    speechStyle: 'Polite and fretful.',
    appearance: 'Short black hair, dark kimono, often carrying the pig Tonton.',
    tags: ['canon', 'leaf'],
  },
  {
    name: 'Yamato',
    aliases: ['Tenzo', 'Captain Yamato'],
    birthday: { month: 8, day: 10 },
    birthYear: -5,
    role: 'Leaf ANBU · Wood Style user',
    personality: 'Dutiful, polite, quietly intimidating.',
    speechStyle: 'Formal, with a scary stare when crossed.',
    appearance: 'Short brown hair, wide dark eyes, a face-guard headband.',
    tags: ['canon', 'leaf', 'anbu'],
  },
  {
    name: 'Karin',
    aliases: ['Karin Uzumaki'],
    birthday: { month: 3, day: 30 },
    birthYear: 4,
    role: 'Uzumaki sensor',
    personality: 'Sharp-tongued, guarded, secretly sentimental.',
    speechStyle: 'Snappish.',
    appearance: 'Long red hair cut unevenly, red eyes, glasses.',
    tags: ['canon', 'uzumaki', 'rogue'],
  },
  {
    name: 'Suigetsu Hozuki',
    aliases: ['Suigetsu'],
    birthday: { month: 2, day: 18 },
    birthYear: 5,
    role: 'Hozuki clan · Mist',
    personality: 'Cheeky, sword-obsessed, lazy.',
    speechStyle: 'Mocking and casual.',
    appearance: 'White-blue hair, purple eyes, shark-like teeth, always drinking water.',
    tags: ['canon', 'mist', 'rogue'],
  },
  {
    name: 'Jūzō Biwa',
    aliases: ['Juzo Biwa', 'Juzo', 'Jūzō'],
    birthday: { month: 4, day: 10 },
    birthYear: -18,
    role: 'Akatsuki · former Mist swordsman',
    personality: 'Calm, deadly, a man of few words.',
    speechStyle: 'Low and economical.',
    appearance: 'Bandaged lower face, heavy brows, the axe-sword Kubikiribōchō.',
    tags: ['canon', 'akatsuki', 'mist'],
  },
];

function lower(value: string) {
  return value.trim().toLowerCase();
}

function namesOf(entity: { name: string; aliases: string[] }) {
  return [entity.name, ...entity.aliases].map(lower);
}

/** Cast entries become entities. Existing saves get the people they lack. */
export function castEntity(entry: CastEntry, id: string): EntityRecord {
  const lore = loreProfileFor(entry.name);

  return {
    id,
    name: entry.name,
    type: 'character',
    aliases: [...entry.aliases],
    birthday: entry.birthday,
    birthYear: entry.birthYear,
    role: entry.role,
    personality: entry.personality,
    speechStyle: entry.speechStyle,
    status: entry.status ?? 'Not yet met',
    ...(entry.status === 'Deceased' ? { deceased: { known: true } } : {}),
    notes: '',
    mood: 'Unknown',
    appearance: entry.appearance,
    romanceAccessibility: lore?.romanceAccessibility ?? 'winnable',
    canonDevotion: lore?.canonDevotion,
    orientation: lore?.orientation,
    met: false,
    tags: [...entry.tags],
  };
}

/**
 * Adds missing canon cast members to a save. A cast member who already exists
 * under any of their names gets the missing names added as aliases, so the
 * state tracker can find them however the story calls them. Never touches
 * anyone's story details, and never adds someone the save already has.
 */
export function ensureCanonCast(
  entities: EntityRecord[],
  makeEntityId: () => string
): EntityRecord[] {
  const next = [...entities];

  for (const entry of CANON_CAST) {
    const entryNames = namesOf(entry);
    const index = next.findIndex(
      (entity) =>
        entity.type === 'character' &&
        namesOf(entity).some((name) => entryNames.includes(name))
    );

    if (index === -1) {
      next.push(castEntity(entry, makeEntityId()));
      continue;
    }

    const existing = next[index];
    const known = new Set(namesOf(existing));
    const missing = [entry.name, ...entry.aliases].filter((name) => !known.has(lower(name)));

    if (missing.length > 0) {
      next[index] = {
        ...existing,
        aliases: [...existing.aliases, ...missing].slice(0, 10),
        birthday: existing.birthday ?? entry.birthday,
        birthYear: existing.birthYear ?? entry.birthYear,
      };
    }
  }

  return next;
}

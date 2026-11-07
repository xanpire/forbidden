export type RelationshipStage =
  | 'stranger'
  | 'friendly'
  | 'close'
  | 'romantic interest'
  | 'partner'
  | 'rejected'
  /** Was with Kan once; it ended. Canon-bound hearts land here (canonEndgame). */
  | 'ex';

export type Attraction = 'none' | 'warm' | 'strong';

export type RomanceAccessibility = 'winnable' | 'lore-locked';

const RELATIONSHIP_STAGES: RelationshipStage[] = [
  'stranger',
  'friendly',
  'close',
  'romantic interest',
  'partner',
  'rejected',
  'ex',
];

const ATTRACTIONS: Attraction[] = ['none', 'warm', 'strong'];

export function normalizeRelationship(value: string | undefined): RelationshipStage | undefined {
  if (!value) {
    return undefined;
  }

  const lower = value.trim().toLowerCase();

  const exact = RELATIONSHIP_STAGES.find((stage) => stage === lower);

  if (exact) {
    return exact;
  }

  if (
    lower === 'exes' ||
    lower.startsWith('ex-') ||
    lower.startsWith('ex ') ||
    lower.includes('former partner') ||
    lower.includes('former lover') ||
    lower.includes('broke up') ||
    lower.includes('broken up')
  ) {
    return 'ex';
  }

  if (lower.includes('reject') || lower.includes('refus') || lower.includes('deni')) {
    return 'rejected';
  }

  if (lower.includes('partner') || lower.includes('lover') || lower.includes('dating')) {
    return 'partner';
  }

  if (lower.includes('romantic') || lower.includes('interest') || lower.includes('crush')) {
    return 'romantic interest';
  }

  if (lower.includes('close') || lower.includes('bonded') || lower.includes('trusted')) {
    return 'close';
  }

  if (lower.includes('friend') || lower.includes('friendly') || lower.includes('ally')) {
    return 'friendly';
  }

  if (lower.includes('stranger')) {
    return 'stranger';
  }

  return undefined;
}

export function normalizeAttraction(value: string | undefined): Attraction | undefined {
  if (!value) {
    return undefined;
  }

  const lower = value.trim().toLowerCase();

  const exact = ATTRACTIONS.find((level) => level === lower);

  if (exact) {
    return exact;
  }

  if (lower.includes('none') || lower.includes('no') || lower.includes('indiffer')) {
    return 'none';
  }

  if (lower.includes('strong') || lower.includes('deep')) {
    return 'strong';
  }

  if (lower.includes('warm') || lower.includes('soft') || lower.includes('mild')) {
    return 'warm';
  }

  return undefined;
}

export type CharacterLoreProfile = {
  canonDevotion: string;
  romanceAccessibility: RomanceAccessibility;
  orientation: string;
  /**
   * Winnable, but canon wins in the end: from this date she is with her canon
   * partner, and anything she had with Kan is over (canonEndgame.ts).
   */
  canonEndgame?: { partner: string; from: { year: number; month: number } };
};

// Lore-accurate hearts. "lore-locked" characters have canon feelings that do
// not bend to Kan no matter what; "winnable" characters can develop real
// feelings for Kan over long, genuinely earned story time.
export const CHARACTER_LORE: Record<string, CharacterLoreProfile> = {
  'Sakura Haruno': {
    canonDevotion: 'Devoted to Sasuke Uchiha since childhood; will stay loyal to that devotion.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to men (Sasuke)',
  },
  'Hinata Hyuga': {
    canonDevotion: 'Loves Naruto Uzumaki quietly and completely since the Academy.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to men (Naruto)',
  },
  'Ino Yamanaka': {
    canonDevotion: 'Outgrows her Sasuke crush; can truly love Kan, but in the end she belongs with Sai.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men (ends up with Sai)',
    canonEndgame: { partner: 'Sai', from: { year: 25, month: 3 } },
  },
  'Tenten': {
    canonDevotion: 'Married to her weapons craft; romance is a low priority for her.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men',
  },
  'Temari': {
    canonDevotion: 'Sharp and pragmatic; can truly love Kan, but in the end she belongs with Shikamaru.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men (ends up with Shikamaru)',
    canonEndgame: { partner: 'Shikamaru Nara', from: { year: 24, month: 10 } },
  },
  'Anko Mitarashi': {
    canonDevotion: 'Loud, dangerous, and guarded under the bravado; softness is rare and earned.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men',
  },
  'Kurenai Yuhi': {
    canonDevotion: 'In love with Asuma Sarutobi; carries his child after his death.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to men (Asuma)',
  },
  'Shizune': {
    canonDevotion: 'Dutiful to Tsunade first; shy and proper about romance.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men',
  },
  'Tsunade Senju': {
    canonDevotion: 'Haunted by Dan and Nawaki; flirts with Jiraiya but commits to no one.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to men (Dan, past)',
  },
  'Mei Terumi': {
    canonDevotion: 'Wants love desperately but is terrifyingly picky and quick to threaten',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men',
  },
  'Jiraiya': {
    canonDevotion: 'Loves Tsunade since youth; never stops flirting with her.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to women (Tsunade)',
  },
  'Itachi Uchiha': {
    canonDevotion: 'His heart belongs to his brother and the village; love is a luxury he denied himself.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested; devoted to duty',
  },
  'Kisame Hoshigaki': {
    canonDevotion: 'Loyal to the Akatsuki\'s lie and to Itachi; romance is foreign to him.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Konan': {
    canonDevotion: 'Her heart died with Yahiko; she guards Pain\'s dream instead.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to men (Yahiko, past)',
  },
  'Pain': {
    canonDevotion: 'A self-made god who mourns Yahiko; romance does not exist for him.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Sasori': {
    canonDevotion: 'Made himself a puppet; discarded human feeling decades ago.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Deidara': {
    canonDevotion: 'In love with his art; people are audiences, not partners.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Hidan': {
    canonDevotion: 'Worships Jashin; treats intimacy as ritual slaughter material.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested (Jashin zealot)',
  },
  'Kakuzu': {
    canonDevotion: 'Values money and self-preservation; humans are expenses.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Tobi': {
    canonDevotion: 'His heart broke with Rin decades ago; obsession replaced love.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to women (Rin, past)',
  },
  'Kabuto Yakushi': {
    canonDevotion: 'Identity crisis dressed as loyalty; intimacy confuses him.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Orochimaru': {
    canonDevotion: 'Obsessed with jutsu and immortality; bodies are vessels.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Danzo Shimura': {
    canonDevotion: 'Consumed by power; feelings are weaknesses he carved out long ago.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Kakashi Hatake': {
    canonDevotion: 'Guarded behind the mask; grief keeps intimacy distant.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women',
  },
  'Kiba Inuzuka': {
    canonDevotion: 'Loud, competitive, warm once trust is established.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women',
  },
  'Rock Lee': {
    canonDevotion: 'In love with Sakura; devoted to youth and effort.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to women (Sakura)',
  },
  'Neji Hyuga': {
    canonDevotion: 'Composed and dutiful; warmth comes slowly after his uncle\'s shadow lifts.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women',
  },
  'Shikamaru Nara': {
    canonDevotion: 'Lazy romantic; claims women are troublesome, falls hard anyway.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women',
  },
  'Gaara': {
    canonDevotion: 'Learning love itself through family; romance is a language he barely speaks.',
    romanceAccessibility: 'winnable',
    orientation: 'Unclear; still learning connection',
  },
  'Naruto Uzumaki': {
    canonDevotion: 'Loves Sakura through his youth, and Hinata waits for him at the end.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to women (Sakura, then Hinata)',
  },
  'Sasuke Uchiha': {
    canonDevotion: 'Revenge first; everything else is noise he does not hear.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested until the very end',
  },
  'Killer Bee': {
    canonDevotion: 'Raps, laughs, and loves life; friendly to everyone in his odd way.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women',
  },
  'Karin': {
    canonDevotion: 'Obsessed with Sasuke\'s chakra; taste in men is questionable.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men (Sasuke-fixated)',
  },
  'Suigetsu Hozuki': {
    canonDevotion: 'Blunt sword nerd; flirts carelessly.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women',
  },
  'Izumi Uchiha': {
    canonDevotion: 'Kan\'s late teammate; her heart belonged to Itachi Uchiha until the night she died.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to men (devoted to Itachi)',
  },
  'Team 3': {
    canonDevotion: 'Kan, Hana, Izumi, and Suzume were a team before the massacre split them.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not applicable',
  },
  'Hana Inuzuka': {
    canonDevotion: 'Loyal to her pack and her village; blunt about everything but her own heart.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men',
  },
  'Suzume': {
    canonDevotion: 'Dedicated to her students and the village; guarded about her private life.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men',
  },
  'Hiruzen Sarutobi': {
    canonDevotion: 'A widower still faithful to his late wife Biwako.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to women (Biwako, past)',
  },
  'Asuma Sarutobi': {
    canonDevotion: 'In love with Kurenai Yuhi; their child is born after he dies.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to women (Kurenai)',
  },
  'Shisui Uchiha': {
    canonDevotion: 'Gave everything, his eyes and his life, to peace and to Itachi.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Zetsu': {
    canonDevotion: 'A spy with no heart of its own to give.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not applicable',
  },
  'Might Guy': {
    canonDevotion: 'Burns for youth and his rivalry with Kakashi; romance would floor him.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women',
  },
  'Yamato': {
    canonDevotion: 'Dutiful and private; has never let himself want much.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women',
  },
  'Jūzō Biwa': {
    canonDevotion: 'A swordsman who lives for the blade and the job.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  // ── Added with the wider canon cast ───────────────────────────────────────
  'Choji Akimichi': {
    canonDevotion: 'Loyal to his friends above all; shy and sweet about romance.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women (eventually Karui)',
  },
  'Shino Aburame': {
    canonDevotion: 'Reserved and logical; feelings come out slowly and sincerely.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women',
  },
  'Sai': {
    canonDevotion: 'Trained to feel nothing; learns love the way he learns words, from books.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women (eventually Ino)',
  },
  'Iruka Umino': {
    canonDevotion: 'Devoted to his students; lonely and hopeful about love.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women',
  },
  'Konohamaru Sarutobi': {
    canonDevotion: 'A child who sees Kan as a grown-up to impress, never more.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not applicable (a child)',
  },
  'Hanabi Hyuga': {
    canonDevotion: 'A child ten years Kan’s junior; at most a little-sister figure.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not applicable (a child)',
  },
  'Hiashi Hyuga': {
    canonDevotion: 'A widower who gives his heart only to his clan and daughters.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Shikaku Nara': {
    canonDevotion: 'Married to Yoshino; complains about her and adores her.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to women (Yoshino)',
  },
  'Inoichi Yamanaka': {
    canonDevotion: 'A married family man devoted to his wife and Ino.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to women (his wife)',
  },
  'Choza Akimichi': {
    canonDevotion: 'A married family man devoted to his wife and Choji.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to women (his wife)',
  },
  'Tsume Inuzuka': {
    canonDevotion: 'Raises her pack alone; has no patience for soft talk.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men',
  },
  'Ibiki Morino': {
    canonDevotion: 'Married to his work; reads affection as a tactic.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Genma Shiranui': {
    canonDevotion: 'Easygoing flirt who never lets anything get serious.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women',
  },
  'Gekko Hayate': {
    canonDevotion: 'In love with Yūgao of ANBU; his heart is spoken for.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to women (Yūgao)',
  },
  'Kotetsu Hagane': {
    canonDevotion: 'Laid-back and single; romance happens to him, if at all.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women',
  },
  'Izumo Kamizuki': {
    canonDevotion: 'Steady and private about matters of the heart.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women',
  },
  'Homura Mitokado': {
    canonDevotion: 'An old councillor whose only devotion is the village.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Koharu Utatane': {
    canonDevotion: 'An old councillor whose only devotion is the village.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Teuchi': {
    canonDevotion: 'A widowed father devoted to his daughter and his broth.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Ayame': {
    canonDevotion: 'Kind to every customer; her heart opens only slowly.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men',
  },
  'Minato Namikaze': {
    canonDevotion: 'Loved Kushina Uzumaki and died beside her.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to women (Kushina)',
  },
  'Kushina Uzumaki': {
    canonDevotion: 'Loved Minato Namikaze and died beside him.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to men (Minato)',
  },
  'Fugaku Uchiha': {
    canonDevotion: 'Married to Mikoto; his heart was his clan.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to women (Mikoto)',
  },
  'Mikoto Uchiha': {
    canonDevotion: 'Married to Fugaku; devoted to her sons to the end.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to men (Fugaku)',
  },
  'Rin Nohara': {
    canonDevotion: 'Loved Kakashi Hatake, and was loved by Obito.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to men (Kakashi)',
  },
  'Hashirama Senju': {
    canonDevotion: 'Married to Mito Uzumaki; his other love was the village.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to women (Mito)',
  },
  'Tobirama Senju': {
    canonDevotion: 'Lived for the village and its institutions; romance never figured.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Dan Katō': {
    canonDevotion: 'Loved Tsunade and died in her hands.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to women (Tsunade)',
  },
  'Kankuro': {
    canonDevotion: 'Puppets and family first; brash about women, awkward with feelings.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women',
  },
  'Chiyo': {
    canonDevotion: 'An old woman living with her guilt; romance is long behind her.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Rasa': {
    canonDevotion: 'His wife Karura died for Gaara; what love he had died with her.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to women (Karura, past)',
  },
  'Baki': {
    canonDevotion: 'A soldier of the Sand; duty leaves no room for love.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Zabuza Momochi': {
    canonDevotion: 'Calls himself a demon; Haku is the only one he cannot push away.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Haku': {
    canonDevotion: 'Lives and would die for Zabuza; no one else reaches him.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Devoted to Zabuza',
  },
  'Yagura': {
    canonDevotion: 'A puppet under genjutsu; there is no one home to love.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Ao': {
    canonDevotion: 'An old soldier of the Mist; loyalty to the Mizukage is all.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Chojuro': {
    canonDevotion: 'Shy and earnest; would never dare speak first.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women',
  },
  'Utakata': {
    canonDevotion: 'Keeps everyone at a distance after his master’s betrayal.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women',
  },
  'A': {
    canonDevotion: 'His village and his brother are everything; love is beside the point.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Darui': {
    canonDevotion: 'Too relaxed to chase anyone; loyal once he cares.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women',
  },
  'Yugito Nii': {
    canonDevotion: 'Proud and private; trusts few and loves fewer.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men',
  },
  'Omoi': {
    canonDevotion: 'Overthinks every feeling into a disaster before it starts.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to women',
  },
  'Karui': {
    canonDevotion: 'Tough and blunt; can truly love Kan, but in the end she belongs with Choji.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men (ends up with Choji)',
    canonEndgame: { partner: 'Choji Akimichi', from: { year: 25, month: 6 } },
  },
  'Samui': {
    canonDevotion: 'Cool and unimpressed; warms only to steady competence.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men',
  },
  'Onoki': {
    canonDevotion: 'An old Kage whose love is his village and granddaughter.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Kurotsuchi': {
    canonDevotion: 'Teasing and bold; no one has caught her interest yet.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men',
  },
  'Roshi': {
    canonDevotion: 'A wandering hermit who left people behind.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Han': {
    canonDevotion: 'A silent wanderer carrying his beast; keeps to himself.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Fū': {
    canonDevotion: 'Starved for friendship; friendship comes long before anything more.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men',
  },
  'Hanzō': {
    canonDevotion: 'A paranoid tyrant; trusts no one, loves no one.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Yahiko': {
    canonDevotion: 'Gave his heart to Konan and his dream of peace.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to women (Konan)',
  },
  'Chiriku': {
    canonDevotion: 'A monk who gave his life to the temple and its vows.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Mifune': {
    canonDevotion: 'An old samurai bound by honor and duty.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Fukasaku': {
    canonDevotion: 'An ancient toad, happily married to Shima.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not applicable (a toad)',
  },
  'Kimimaro': {
    canonDevotion: 'Lives only to be useful to Orochimaru.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Jugo': {
    canonDevotion: 'Gentle and afraid of himself; clings to the few who calm him.',
    romanceAccessibility: 'winnable',
    orientation: 'Unclear; still learning connection',
  },
  'Tayuya': {
    canonDevotion: 'Snarls at everyone; softness is something she’d kill to hide.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men',
  },
  'Sakon': {
    canonDevotion: 'Loyal to Orochimaru and his twin; others are toys.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Ukon': {
    canonDevotion: 'Lives inside his brother; there is room for no one else.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Jirobo': {
    canonDevotion: 'Resentful and hungry for respect, not love.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
  'Kidomaru': {
    canonDevotion: 'Treats people as pieces in his game.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Not interested',
  },
};

function loreKey(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Loose lookup for names the story shortens or extends ("Ino" for "Ino
 * Yamanaka", "Kisame" for "Kisame Hoshigaki"): one name must appear in the
 * other as whole words, so "Han" never picks up Hana Inuzuka's heart.
 */
function sameNameLoosely(a: string, b: string) {
  if (!a || !b) {
    return false;
  }

  const shorter = a.length <= b.length ? a : b;
  const longer = shorter === a ? b : a;

  // Very short names ("A", "Ao", "Fū") only ever match exactly.
  if (shorter.length < 3) {
    return false;
  }

  return ` ${longer} `.includes(` ${shorter} `);
}

const LORE_BY_KEY = new Map<string, CharacterLoreProfile>(
  Object.entries(CHARACTER_LORE).map(([name, profile]) => [loreKey(name), profile])
);

export function loreProfileFor(name: string): CharacterLoreProfile | null {
  const key = loreKey(name);

  const direct = LORE_BY_KEY.get(key);

  if (direct) {
    return direct;
  }

  for (const [entryKey, profile] of LORE_BY_KEY) {
    if (sameNameLoosely(entryKey, key)) {
      return profile;
    }
  }

  return null;
}

// Prompt rules: injected into the narration system prompt. Kept compact to
// protect the token budget.
export const ROMANCE_RULES = `ROMANCE
- Romance is slow, earned over many scenes, and can fail. NPCs have loves of their own. Bonds show a stage, an attraction, and a lore heart.
- Lore-locked hearts never turn to Kan: Sakura→Sasuke, Hinata→Naruto, Jiraiya→Tsunade, Kurenai↔Asuma, Rock Lee→Sakura, Konan→Yahiko, Naruto→Hinata (late), Minato↔Kushina, Haku→Zabuza, Hayate→Yūgao; married elders stay married. Friendship can still grow.
- Winnable hearts (Tenten, Anko, Shizune, Mei, Kakashi, Kiba, Neji, Shikamaru, Gaara, Killer Bee, Karin, Suigetsu, Hana Inuzuka, Suzume, Sai, Choji, Shino, Kankuro, Darui, Yugito, Fū, Kurotsuchi, Samui, originals) open only through long, consistent effort, never one kind act.
- Canon-bound hearts (Temari→Shikamaru, Ino→Sai, Karui→Choji) can truly love Kan, but canon wins. As her canon time nears, the story ends it naturally: duty, distance, growing apart, her own choice; never cheating or a sudden change of character. After that Kan is her ex, she is with her canon partner, and she does not go back to Kan.
- Adults deflect Kan's advances while he is under 17; from 17 an adult heart may open if earned. Teen attraction is honest (tension, confessions, kissing). Explicit intimacy only when both are 18+ in-story, written openly with no fade-out; younger, the scene stops at the boundary without moralizing.
- A rejection holds by default: the refusal stands, and Kan pushing again only hardens it. It is not forever. Over a long stretch of in-story time and many scenes, someone who turned Kan down can change their mind as they truly come to know him: his real self behind the reserve, what he has done for them or others, or the power he keeps hidden. The change comes from their side, never soon after the refusal, never from repeated asking, needs a clear reason in the story, and moves in steps (rejected → friendly/close → romantic interest). Lore-locked hearts and the age rules above still hold.`;
export type EraKey = 'pre' | 'part1' | 'shippuden' | 'war' | 'after';

export function eraKeyForYear(year: number): EraKey {
  if (year < 17) return 'pre';
  if (year < 20) return 'part1';
  if (year < 23) return 'shippuden';
  if (year < 24) return 'war';
  return 'after';
}

// Personality shifts that canon characters undergo between eras. Kept separate
// from the static lore profile so prompts only pay for the era that matters.
const ERA_NOTES: Record<string, Partial<Record<EraKey, string>>> = {
  'Naruto Uzumaki': {
    pre: 'Loud, lonely, desperate for acknowledgment.',
    part1: 'Brash and bright; believes effort beats talent.',
    shippuden: 'Calmer, grieving Jiraiya, carrying the village\'s hope.',
    war: 'Composed; refuses to give up on Obito or Sasuke.',
    after: 'The Seventh Hokage: warm, tired, still stubborn.',
  },
  'Sasuke Uchiha': {
    pre: 'Silent survivor; revenge already hardening him.',
    part1: 'Cold and driven; the cursed seal whispers.',
    shippuden: 'Calculating, hollowed out by hatred.',
    war: 'Broken, then slowly reaching for redemption.',
    after: 'A wandering penitent; quiet and guarded.',
  },
  'Sakura Haruno': {
    pre: 'Book-smart, insecure, smitten with Sasuke.',
    part1: 'Growing from fangirl to determined kunoichi.',
    shippuden: 'Formidable medic-nin; still loves Sasuke.',
    war: 'Battlefield healer holding her team together.',
  },
  'Kakashi Hatake': {
    pre: 'Late, lazy, hiding grief behind a book.',
    part1: 'Testing his team while remembering Obito.',
    shippuden: 'Sharper, carrying the weight of command.',
    war: 'Fighting Obito, facing his oldest wound.',
    after: 'The Sixth Hokage: steady and quietly proud.',
  },
  'Itachi Uchiha': {
    pre: 'Gentle older brother wearing a killer\'s mask.',
    part1: 'Cold Akatsuki partner; secretly a double agent.',
    shippuden: 'Dying, orchestrating his own defeat.',
    war: 'Edo Tensei: lucid, at peace, fighting for the living.',
  },
  'Tsunade Senju': {
    part1: 'Gambling, drinking, refusing the hat.',
    shippuden: 'Hokage; stubborn, decisive, protective.',
    war: 'Leading the Alliance\'s medical corps.',
  },
  'Jiraiya': {
    part1: 'Flirtatious mentor, dodging Tsunade\'s rejection.',
    shippuden: 'Dying to learn Pain\'s secret.',
  },
  'Hinata Hyuga': {
    pre: 'Shy, watching Naruto from a distance.',
    part1: 'Braver, still devoted in silence.',
    shippuden: 'Ready to stand and fight beside him.',
    war: 'Resolute; love turned into courage.',
  },
  'Gaara': {
    part1: 'Unstable, blood-hungry vessel of the Shukaku.',
    shippuden: 'Kazekage: calm, protective of his village.',
    war: 'Leading the Sand, steady as stone.',
  },
  'Pain': {
    shippuden: 'A god of pain, still grieving Yahiko.',
    war: 'Dead; his will lives on in Konan.',
  },
  'Konan': {
    shippuden: 'Quiet guardian of Pain\'s dream.',
    war: 'Defending his grave with her life.',
  },
  'Orochimaru': {
    part1: 'Predatory, curious, plotting the invasion.',
    shippuden: 'Weakened, then absorbed by Sasuke.',
    war: 'Reborn: cold, curious, strangely cooperative.',
  },
  'Tobi': {
    pre: 'A masked manipulator borrowing Madara\'s name.',
    shippuden: 'Cheerful "Tobi" mask over bottomless grief.',
    war: 'The mask cracks; the boy beneath is furious and broken.',
  },
  'Hana Inuzuka': {
    pre: 'Grieving teammate; furious Kan vanished without a word.',
    part1: 'Chunin patrol leader: sharp, hurt, still loyal.',
    shippuden: 'Jonin; steady, protective, quietly watching for Kan.',
    war: 'Fighting for Hidden Leaf, scanning every battlefield for him.',
  },
  'Suzume': {
    pre: 'Searching for her missing student; betrayed and worried.',
    part1: 'Sensei of a new team; wary of what Kan became.',
    shippuden: 'Investigating Kan\'s trail through official channels.',
    war: 'Serving the Alliance; she will not abandon a student.',
  },
  'Kisame Hoshigaki': {
    pre: 'Loyal monster; respects strength above all.',
    shippuden: 'Itachi\'s steadfast partner, hiding doubts.',
    war: 'Dying for a cause he barely understands.',
  },
};


export function eraNoteFor(name: string, year: number): string | null {
  const key = loreKey(name);
  const direct = ERA_NOTES[name];
  if (direct) {
    return direct[eraKeyForYear(year)] ?? null;
  }

  for (const [entryName, notes] of Object.entries(ERA_NOTES)) {
    if (sameNameLoosely(loreKey(entryName), key)) {
      return notes[eraKeyForYear(year)] ?? null;
    }
  }

  return null;
}

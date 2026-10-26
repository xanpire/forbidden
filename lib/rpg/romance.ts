export type RelationshipStage =
  | 'stranger'
  | 'friendly'
  | 'close'
  | 'romantic interest'
  | 'partner'
  | 'rejected';

export type Attraction = 'none' | 'warm' | 'strong';

export type RomanceAccessibility = 'winnable' | 'lore-locked';

const RELATIONSHIP_STAGES: RelationshipStage[] = [
  'stranger',
  'friendly',
  'close',
  'romantic interest',
  'partner',
  'rejected',
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
    canonDevotion: 'Chased Sasuke in her youth, but grows past it into confident independence.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men',
  },
  'Tenten': {
    canonDevotion: 'Married to her weapons craft; romance is a low priority for her.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men',
  },
  'Temari': {
    canonDevotion: 'Sharp and pragmatic; warms slowly to people who impress her mind, not her heart.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men (eventually Shikamaru)',
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
    canonDevotion: 'Her heart died with Yahiko; she guards Nagato\'s dream instead.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Attracted to men (Yahiko, past)',
  },
  'Pain': {
    canonDevotion: 'Nagato is a god who mourns Yahiko; romance does not exist for him.',
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
  'The masked man': {
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
    canonDevotion: 'Kan\'s late teammate; gentle and quietly stubborn in memory.',
    romanceAccessibility: 'lore-locked',
    orientation: 'Unknown',
  },
  'Hana Inuzuka': {
    canonDevotion: 'Loyal to her pack and her village; blunt about everything but her own heart.',
    romanceAccessibility: 'winnable',
    orientation: 'Attracted to men',
  },
};

function loreKey(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
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
    if (entryKey.includes(key) || key.includes(entryKey)) {
      return profile;
    }
  }

  return null;
}

// Prompt rules: injected into the narration system prompt. Kept compact to
// protect the token budget.
export const ROMANCE_RULES = `ROMANCE & HEARTS (LORE-ACCURATE)
- Characters are people, not reward systems. Romance is slow, earned over many scenes, and can fail.
- Each bond carries a relationship stage (stranger, friendly, close, romantic interest, partner, rejected), an attraction level (none, warm, strong), and — for canon characters — a lore heart.
- LORE-LOCKED hearts: canon love wins. Sakura stays devoted to Sasuke, Hinata to Naruto, Jiraiya to Tsunade, Kurenai to Asuma's memory, Rock Lee to Sakura, Konan to Yahiko, Naruto to Sakura then Hinata. Kan's love is ignored or gently refused; deep friendship may still grow.
- WINNABLE hearts: Ino, Tenten, Temari, Anko, Shizune, Mei, Kakashi, Kiba, Neji, Shikamaru, Gaara, Killer Bee, Karin, Suigetsu, and player-created characters. Feelings develop only through long, consistent, earned story time — never from one kind gesture.
- ADULT GATING: while Kan is under 17, adult NPCs respond to romantic advances with in-character deflection, laughter, or a stern no — mentorship and banter remain open. From 17+, adult hearts can open if genuinely earned.
- AGE & INTIMACY: attraction between teens is narrated honestly (tension, confessions, kissing). Explicit intimacy is narrated in full without fading or censoring — but only when both characters are adults (18+) in-story. If either is under 18, the scene narrates desire and stops at the boundary of explicit content; do not moralize, just let the age be real.
- NEVER CENSOR: do not fade to black, skip, or sanitize romance or intimacy when ages permit. Write it openly and tastefully — the reader wants the real moment.
- REJECTION PERSISTS: when a character declines Kan, record it. Do not reset, re-offer, or loop. A rejected heart can still become a friend; it does not become a prize waiting for persistence.
- Relationships exist independently of Kan: NPCs love, mourn, and want each other, with or without him.`;
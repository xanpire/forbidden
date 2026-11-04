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
export const ROMANCE_RULES = `ROMANCE
- Romance is slow, earned over many scenes, and can fail. NPCs have loves of their own. Bonds show a stage, an attraction, and a lore heart.
- Lore-locked hearts never turn to Kan: Sakura→Sasuke, Hinata→Naruto, Jiraiya→Tsunade, Kurenai→Asuma, Rock Lee→Sakura, Konan→Yahiko, Naruto→Hinata (late). Friendship can still grow.
- Winnable hearts (Ino, Tenten, Temari, Anko, Shizune, Mei, Kakashi, Kiba, Neji, Shikamaru, Gaara, Killer Bee, Karin, Suigetsu, Hana Inuzuka, Suzume, originals) open only through long, consistent effort, never one kind act.
- Adults deflect Kan's advances while he is under 17; from 17 an adult heart may open if earned. Teen attraction is honest (tension, confessions, kissing). Explicit intimacy only when both are 18+ in-story, written openly with no fade-out; younger, the scene stops at the boundary without moralizing.
- Rejection is permanent: never reset, re-offer, or loop it.`;
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
    shippuden: 'Quiet guardian of Nagato\'s dream.',
    war: 'Defending his grave with her life.',
  },
  'Orochimaru': {
    part1: 'Predatory, curious, plotting the invasion.',
    shippuden: 'Weakened, then absorbed by Sasuke.',
    war: 'Reborn: cold, curious, strangely cooperative.',
  },
  'Obito Uchiha': {
    pre: 'A masked manipulator borrowing Madara\'s name.',
    shippuden: 'Cheerful "Tobi" mask over bottomless grief.',
    war: 'The mask cracks; the boy beneath is furious and broken.',
  },
  'The masked man': {
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
    const entryKey = loreKey(entryName);
    if (entryKey.includes(key) || key.includes(entryKey)) {
      return notes[eraKeyForYear(year)] ?? null;
    }
  }

  return null;
}

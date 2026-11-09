import { playerAge, playerName } from './player';
import { locationKindOf } from './encounters';
import type { PlannedReference } from './referencePlan';
import type {
  AppDatabase,
  PortraitExpression,
  PortraitRecord,
  PortraitSetting,
  PortraitSignature,
} from './types';

/**
 * A portrait only depends on a few coarse traits, so it goes stale when one of
 * them changes — not on every mood wording tweak.
 */
const EXPRESSION_RULES: Array<{ expression: PortraitExpression; keywords: string[] }> = [
  { expression: 'angry', keywords: ['angry', 'furious', 'rage', 'enraged', 'livid', 'hostile', 'vengeful', 'bitter'] },
  { expression: 'sad', keywords: ['grief', 'grieving', 'sad', 'mourning', 'heartbroken', 'sorrow', 'tearful', 'despair'] },
  { expression: 'tired', keywords: ['exhausted', 'tired', 'weary', 'drained', 'spent', 'numb', 'hollow', 'wounded', 'injured'] },
  { expression: 'warm', keywords: ['warm', 'happy', 'content', 'amused', 'relieved', 'fond', 'cheerful', 'hopeful', 'playful', 'gentle'] },
  { expression: 'grim', keywords: ['guarded', 'grim', 'cold', 'tense', 'wary', 'focused', 'determined', 'suspicious', 'alert', 'resolute'] },
];

export function expressionFromMood(mood: string): PortraitExpression {
  const lower = mood.toLowerCase();
  let best: { expression: PortraitExpression; index: number } | null = null;

  // The earliest matching word usually leads the mood ("numb, guarded, …").
  for (const rule of EXPRESSION_RULES) {
    for (const keyword of rule.keywords) {
      const index = lower.search(new RegExp(`\\b${keyword}`));

      if (index >= 0 && (!best || index < best.index)) {
        best = { expression: rule.expression, index };
      }
    }
  }

  return best?.expression ?? 'calm';
}

function settingOf(db: AppDatabase): PortraitSetting {
  switch (locationKindOf(db)) {
    case 'settlement':
      return 'village';
    case 'road':
      return 'road';
    case 'structure':
      return 'indoors';
    default:
      return 'wilds';
  }
}

/** What the player wears now, in words (their sheet's outfit, kept current by play). */
export function currentOutfit(db: AppDatabase): string {
  return db.state.player?.outfit?.trim() ?? '';
}

export function portraitSignature(db: AppDatabase): PortraitSignature {
  return {
    age: playerAge(db),
    outfit: currentOutfit(db).slice(0, 120),
    expression: expressionFromMood(db.state.mood),
    setting: settingOf(db),
  };
}

const SETTING_LABEL: Record<PortraitSetting, string> = {
  village: 'a village',
  wilds: 'the wilds',
  road: 'on the road',
  indoors: 'indoors',
};

/** Why the latest portrait no longer matches the player, or null if it still does. */
export function portraitStaleReason(
  latest: PortraitRecord | null,
  current: PortraitSignature
): string | null {
  if (!latest) {
    return 'No portrait yet';
  }

  const before = latest.signature;

  if (before.outfit !== current.outfit) {
    return 'Dressed differently now';
  }

  if (before.age !== current.age) {
    return `Turned ${current.age}`;
  }

  if (before.expression !== current.expression) {
    return `Looks ${current.expression} now`;
  }

  if (before.setting !== current.setting) {
    return current.setting === 'road' ? 'Now on the road' : `Now in ${SETTING_LABEL[current.setting]}`;
  }

  return null;
}

export function latestPortrait(db: AppDatabase): PortraitRecord | null {
  const portraits = db.portraits ?? [];
  return portraits.length > 0 ? portraits[portraits.length - 1] : null;
}

/** Short tag for the history strip: the outfit or age that sets it apart. */
export function portraitTag(portrait: PortraitRecord, index: number, all: PortraitRecord[]) {
  if (index === all.length - 1) {
    return 'NOW';
  }

  const next = all[index + 1];

  if (next && next.signature.age !== portrait.signature.age) {
    return String(portrait.signature.age);
  }

  return next && next.signature.outfit !== portrait.signature.outfit ? 'OUTFIT' : String(portrait.signature.age);
}

const EXPRESSION_TEXT: Record<PortraitExpression, string> = {
  calm: 'calm, composed, unreadable',
  grim: 'guarded and grim, jaw set, eyes sharp',
  angry: 'angry, brows drawn, a cold glare',
  tired: 'tired and hollow-eyed, shoulders heavy',
  warm: 'a rare softness, the hint of a smile',
  sad: 'grief held behind a steady face',
};

export function buildPortraitPrompt(
  db: AppDatabase,
  signature: PortraitSignature,
  references: PlannedReference[]
) {
  const outfit = signature.outfit || 'their usual clothes';
  const who = playerName(db);
  const style = db.world?.artStyle?.trim() || 'cinematic photo, natural light';
  const lines = [
    `Character portrait of ${who}. ${style}.`,
    'Visual image only. No words, letters, numbers, captions, logos, watermarks or readable text anywhere.',
  ];

  references.forEach((reference, i) => {
    const n = i + 1;

    if (reference.kind === 'face') {
      lines.push(
        `Reference image ${n}: ${who}'s face sheet. Match the face exactly: hair, eyes, facial structure, hairline.`
      );
    } else if (reference.kind === 'outfit') {
      lines.push(
        `Reference image ${n}: the outfit ${who} wears now (${outfit}), shown without a person. Dress ${who} in exactly this.`
      );
    } else if (reference.kind === 'previous') {
      lines.push(
        `Reference image ${n}: the previous portrait. Keep the same art style, framing and lighting, but update age, clothes, expression and background as described below.`
      );
    }
  });

  if (!references.some((reference) => reference.kind === 'face')) {
    lines.push(`${who}: ${db.state.player.appearance.trim() || 'the main character'}`);
  }

  lines.push(
    `Age: ${signature.age}. Draw ${who} with the build and face of a ${signature.age}-year-old.`,
    `Expression: ${EXPRESSION_TEXT[signature.expression]}. Current mood: ${db.state.mood}.`,
    `Clothing: ${outfit}.`,
    `Background: softly blurred ${db.state.location}, ${SETTING_LABEL[signature.setting]}, at ${db.state.inStoryDate.hour}:${String(db.state.inStoryDate.minute).padStart(2, '0')}.`,
    `Framing: head and upper body, three-quarter view, centered, vertical portrait. ${who} alone, no other people.`,
    `Style: ${style}, moody lighting, high detail.`,
    'Final reminder: no text or lettering in the image.'
  );

  return (lines.join('\n'));
}

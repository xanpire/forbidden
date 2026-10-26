// English place-name conventions. The AI and UI speak in the English names;
// Japanese village names are translated whenever they have a plain meaning.
// Titles (Hokage, Kage), ranks (genin, chūnin, jōnin), jinchūriki, Sannin,
// chakra, and Akatsuki stay as canon terms.

type Replacement = [RegExp, string];

const REPLACEMENTS: Replacement[] = [
  [/\bKonohagakure\b/gi, 'Hidden Leaf Village'],
  [/\bKonoha\b/gi, 'Hidden Leaf'],
  [/\bthe Leaf Village\b/gi, 'the Hidden Leaf Village'],
  [/\bAmegakure\b/gi, 'Hidden Rain Village'],
  [/\bSunagakure\b/gi, 'Hidden Sand Village'],
  [/\bKirigakure\b/gi, 'Hidden Mist Village'],
  [/\bIwagakure\b/gi, 'Hidden Stone Village'],
  [/\bKumogakure\b/gi, 'Hidden Cloud Village'],
  [/\bOtogakure\b/gi, 'Hidden Sound Village'],
  [/\bTakigakure\b/gi, 'Hidden Waterfall Village'],
  [/\bUzushiogakure\b/gi, 'Hidden Whirlpool Village'],
  [/\bLand of Fire\b/gi, 'Land of Fire'],
  [/\bLand of Wind\b/gi, 'Land of Wind'],
  [/\bLand of Water\b/gi, 'Land of Water'],
  [/\bLand of Lightning\b/gi, 'Land of Lightning'],
  [/\bLand of Earth\b/gi, 'Land of Earth'],
  [/\bLand of Iron\b/gi, 'Land of Iron'],
  [/\bVillage Hidden in the Leaves\b/gi, 'Hidden Leaf Village'],
  [/\bVillage Hidden in the Rain\b/gi, 'Hidden Rain Village'],
  [/\bVillage Hidden in the Sand\b/gi, 'Hidden Sand Village'],
  [/\bVillage Hidden in the Mist\b/gi, 'Hidden Mist Village'],
  [/\bVillage Hidden in the Stone\b/gi, 'Hidden Stone Village'],
  [/\bVillage Hidden in the Clouds?\b/gi, 'Hidden Cloud Village'],
  [/\bVillage Hidden in the Sound\b/gi, 'Hidden Sound Village'],
  [/\bVillage Hidden in the Waterfall\b/gi, 'Hidden Waterfall Village'],
];

export const PLACE_NAME_RULE =
  'Use English place names only: Hidden Leaf (never Konoha), Hidden Rain (never Amegakure), Hidden Sand (never Sunagakure), Hidden Mist (never Kirigakure), Hidden Stone (never Iwagakure), Hidden Cloud (never Kumogakure), Hidden Sound (never Otogakure), and the Land of Fire / Wind / Water / Lightning / Earth / Iron. Keep Hokage, Kage, genin, chūnin, jōnin, jinchūriki, Sannin, chakra, and Akatsuki as they are.';

export function localizePlaceNames(text: string): string {
  if (!text) {
    return text;
  }

  let result = text;

  for (const [pattern, replacement] of REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

export function hasJapanesePlaceName(text: string): boolean {
  return /\b(Konoha|Konohagakure|Amegakure|Sunagakure|Kirigakure|Iwagakure|Kumogakure|Otogakure|Takigakure|Uzushiogakure)\b/i.test(
    text
  );
}
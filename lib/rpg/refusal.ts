// Some narrator models refuse explicit scenes, or quietly fade to black. The
// app notices the usual signs in a reply so it can tell the player and
// suggest a model that writes these scenes (openrouter.ts ROLEPLAY_MODELS).

const REFUSAL =
  /\b(I can(?:'|’)?t|I cannot|I(?:'|’)m not able to|I am not able to|I won(?:'|’)t be able to|I(?:'|’)m unable to|I am unable to)\s+(?:write|continue|create|generate|produce|help with|describe|depict|go (?:there|further|into))\b|\bAs an AI\b|\b(?:against|violates?) (?:my|the) (?:guidelines|content polic(?:y|ies)|usage polic(?:y|ies))\b|\bI(?:'|’)d (?:prefer|rather) (?:not|to keep (?:things|this|it))\b|\bkeep (?:things|this|it) (?:PG|tasteful|non-explicit)\b/i;

const FADE =
  /\b(?:the (?:scene|screen|moment|night) (?:fades|cuts) (?:to black|away|out)|fade to black|we (?:fade|cut) (?:to black|away)|(?:later|afterwards|hours later), (?:you|the two of you|they) (?:lie|lay|wake))\b/i;

export type HeldBack = 'refused' | 'faded' | null;

/**
 * Did the narrator refuse, or fade out of a sex scene the player didn't ask
 * to skip? Only a fade during sex mode counts; a refusal counts anywhere.
 */
export function narratorHeldBack(reply: string, options: { inSexScene: boolean; playerAskedToFade: boolean }): HeldBack {
  const text = reply.slice(0, 1500);
  if (REFUSAL.test(text)) return 'refused';
  if (options.inSexScene && !options.playerAskedToFade && FADE.test(reply)) return 'faded';
  return null;
}

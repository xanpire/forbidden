// Small shared helpers.

export function trimToSentence(text: string): string {
  let cleaned = text.trim();

  const fenceStart = cleaned.indexOf('```');

  if (fenceStart !== -1) {
    cleaned = cleaned.slice(0, fenceStart).trim();
  }

  const labelMatch = /(?:^|\n)\s*(?:chapter|arc|year)\s+summary\s*:\s*\n?/i.exec(cleaned);

  if (labelMatch && cleaned.slice(labelMatch.index + labelMatch[0].length).trim().length > 0) {
    cleaned = cleaned.slice(labelMatch.index + labelMatch[0].length).trim();
  }

  const sentenceEnd = /[.!?](?:["'”’)]+)?(?=\s|$)/g;
  let lastEnd = -1;

  for (const match of cleaned.matchAll(sentenceEnd)) {
    lastEnd = match.index + match[0].length;
  }

  if (lastEnd > 0 && lastEnd < cleaned.length) {
    return cleaned.slice(0, lastEnd).trim();
  }

  return cleaned;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function uniqueList(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

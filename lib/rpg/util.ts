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

/** Small stable string hash (FNV-1a) for deterministic per-turn choices. */
export function hashText(text: string): number {
  let value = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }

  return value >>> 0;
}

/** Player turns so far: the seed for choices that must survive a regenerate. */
export function playerTurnCount(db: { rawLog: { kind: string; role: string }[] }): number {
  return db.rawLog.filter((entry) => entry.kind === 'story' && entry.role === 'user').length;
}

const TITLE_MAX = 60;
const SENTENCE_TITLE_MAX = 90;

/**
 * Splits text into a short title and the rest: "Title: …", else a short
 * first sentence, else the first words cut at a word boundary (the rest of
 * the text stays as the description, so nothing is lost).
 */
export function titleAndBody(text: string): { title: string; body: string | null } {
  const trimmed = text.trim();
  const colon = /^([^:.!?\n]{3,70}):\s+(.+)$/s.exec(trimmed);

  if (colon) {
    return { title: colon[1].trim(), body: colon[2].trim() };
  }

  const sentence = new RegExp(`^(.{8,${SENTENCE_TITLE_MAX}}?[.!?…])(?:["'”’)]*)\\s+(.+)$`, 's').exec(trimmed);

  if (sentence) {
    return { title: sentence[1].trim(), body: sentence[2].trim() };
  }

  if (trimmed.length <= TITLE_MAX) {
    return { title: trimmed, body: null };
  }

  const head = trimmed.slice(0, TITLE_MAX + 1);
  const space = head.lastIndexOf(' ');
  const end = space >= 20 ? space : TITLE_MAX;
  const title = trimmed.slice(0, end).replace(/[\s,;:—–-]+$/, '');
  const rest = trimmed.slice(end).trim();

  return { title: `${title}…`, body: rest ? `…${rest}` : null };
}

/** A short title for a summary that came without one. */
export function shortTitle(text: string): string {
  const { title } = titleAndBody(text);
  const clean = title.replace(/[.!?…]+$/, '').trim();

  if (clean.length <= 48) {
    return clean;
  }

  const head = clean.slice(0, 49);
  const space = head.lastIndexOf(' ');
  return `${clean.slice(0, space >= 16 ? space : 48).replace(/[\s,;:—–-]+$/, '')}…`;
}

/** The first one or two sentences of a text, for a memory's description. */
export function firstSentences(text: string, count = 2, maxLength = 260): string {
  const parts = text.trim().match(/[^.!?]+[.!?]+(?:["'”’)]+)?/g) ?? [text.trim()];
  let result = '';

  for (const part of parts.slice(0, count)) {
    const next = `${result} ${part.trim()}`.trim();

    if (result && next.length > maxLength) {
      break;
    }

    result = next;
  }

  return result.length > maxLength ? `${result.slice(0, maxLength).replace(/\s+\S*$/, '')}…` : result;
}

export type TitledSummary = { title: string | null; memory: string | null; summary: string };

/**
 * Reads a summary reply written as TITLE / MEMORY / SUMMARY lines. A reply
 * without the labels is taken as the summary itself.
 */
export function parseTitledSummary(raw: string): TitledSummary | null {
  const text = raw.replace(/\r/g, '').trim();
  const label = /^\s*\**\s*(TITLE|MEMORY|SUMMARY)\s*\**\s*:\s*\**\s*/gim;
  const marks = [...text.matchAll(label)];

  if (marks.length === 0) {
    const summary = trimToSentence(text);
    return summary ? { title: null, memory: null, summary } : null;
  }

  const fields: Record<string, string> = {};

  marks.forEach((mark, index) => {
    const start = (mark.index ?? 0) + mark[0].length;
    const end = index + 1 < marks.length ? marks[index + 1].index ?? text.length : text.length;
    const key = mark[1].toUpperCase();

    if (!fields[key]) {
      fields[key] = text.slice(start, end).replace(/\*+$/, '').trim();
    }
  });

  const summary = fields.SUMMARY ? trimToSentence(fields.SUMMARY) : '';

  if (!summary) {
    return null;
  }

  const title = (fields.TITLE ?? '')
    .split('\n')[0]
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[.!?]+$/, '')
    .trim()
    .slice(0, 60);
  const memory = fields.MEMORY ? trimToSentence(fields.MEMORY.replace(/\s+/g, ' ')) : '';

  return {
    title: title.length >= 2 ? title : null,
    memory: memory || null,
    summary,
  };
}

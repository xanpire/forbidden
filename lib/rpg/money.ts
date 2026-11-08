/**
 * Kan's money (`state.purse`): how many ryō he carries, and what moved it.
 *
 * The narrator sees one Purse line in CURRENT STATE and the prices below; the
 * state tracker reports every change to Kan's own money (`money`) and, when
 * the prose states his total, the total (`money_counted`). Someone else
 * paying for him changes nothing. A flashback never touches the present
 * purse (its turns go through applyMemoryStep).
 */

import type { AppDatabase, CalendarDate, PurseEntry, PurseState } from './types';

/** What Kan had in his pouch the night he left the Leaf. */
export const STARTING_RYO = 4000;

/** Changes kept for the Kan tab, newest last. */
const HISTORY_LIMIT = 40;
/** No single change or total goes past this (a sanity cap on the tracker). */
const MAX_RYO = 1_000_000_000;

/** Under this the narrator is told the purse is nearly empty. */
export const LOW_PURSE_RYO = 1000;

/**
 * One price scale for the narrator and the tracker, so a meal, a room and a
 * mission's pay stay believable next to the bingo-book bounties (about 1.4M
 * ryō at C-rank, see reputation.ts).
 */
export const PRICE_GUIDE =
  'PRICES (ryō): a meal or a bowl of noodles 300-800; tea or a cheap drink 100-300; a night at a cheap inn 2,000-5,000, a good one 10,000+; a kunai 200, ten shuriken 1,000, an explosive tag 500; a travelling cloak 3,000; passage on a boat 2,000-8,000; a bribe or an informant 1,000-20,000. Mission pay: D-rank 5,000-50,000, C 30,000-100,000, B 80,000-200,000, A 150,000-1,000,000, S 1,000,000+.';

export function startingPurse(estimated = false): PurseState {
  return { ryo: STARTING_RYO, history: [], ...(estimated ? { estimatedStart: true } : {}) };
}

/** Old saves get the starting amount, marked as a guess until Kan counts his money. */
export function normalizePurse(value: unknown): PurseState {
  if (!value || typeof value !== 'object') return startingPurse(true);

  const purse = value as Partial<PurseState>;
  const ryo = typeof purse.ryo === 'number' && Number.isFinite(purse.ryo) ? clampRyo(purse.ryo) : STARTING_RYO;
  const history = Array.isArray(purse.history)
    ? purse.history
        .filter(
          (entry): entry is PurseEntry =>
            Boolean(entry) &&
            typeof entry.change === 'number' &&
            Number.isFinite(entry.change) &&
            typeof entry.reason === 'string' &&
            Boolean(entry.date)
        )
        .map((entry) => ({
          date: entry.date,
          change: Math.round(entry.change),
          reason: entry.reason.slice(0, 80),
          ...(entry.counted ? { counted: true } : {}),
        }))
        .slice(-HISTORY_LIMIT)
    : [];

  return { ryo, history, ...(purse.estimatedStart ? { estimatedStart: true } : {}) };
}

export function purseOf(db: AppDatabase): PurseState {
  return db.state.purse ?? startingPurse(true);
}

function clampRyo(amount: number) {
  return Math.max(0, Math.min(MAX_RYO, Math.round(amount)));
}

/** A number the tracker wrote, as a number ("-1,200", "500 ryō" and 500 all work). */
export function readRyo(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  if (typeof value !== 'string') return null;

  const match = value.replace(/[,\s_]/g, '').match(/^([+\-−]?)(\d+(?:\.\d+)?)/);

  if (!match) return null;

  const amount = Math.round(Number(match[2]));

  return match[1] === '-' || match[1] === '−' ? -amount : amount;
}

export type MoneyChange = { amount: number; reason: string };

/**
 * Applies this turn's money changes, then the total if the prose stated one.
 * A payment can't take Kan below nothing: he pays what he has.
 */
export function applyPurse(
  db: AppDatabase,
  changes: MoneyChange[] | undefined,
  counted?: number
): AppDatabase {
  const hasChanges = Boolean(changes?.length);
  const hasCount = typeof counted === 'number' && Number.isFinite(counted) && counted >= 0;

  if (!hasChanges && !hasCount) return db;

  const date: CalendarDate = db.state.inStoryDate;
  const before = purseOf(db);
  let ryo = before.ryo;
  const added: PurseEntry[] = [];

  for (const change of changes ?? []) {
    const amount = Math.max(-MAX_RYO, Math.min(MAX_RYO, Math.round(change.amount)));
    // Paying more than he has: he pays what he has.
    const applied = amount < 0 ? Math.max(amount, -ryo) : amount;

    if (applied === 0) continue;

    ryo = clampRyo(ryo + applied);
    added.push({ date, change: applied, reason: cleanReason(change.reason, applied) });
  }

  let estimatedStart = before.estimatedStart;

  if (hasCount) {
    const total = clampRyo(counted!);

    if (total !== ryo) {
      added.push({ date, change: total - ryo, reason: 'You counted what you have', counted: true });
      ryo = total;
    }

    // Once Kan has counted his money, the starting guess no longer matters.
    estimatedStart = undefined;
  }

  if (added.length === 0 && estimatedStart === before.estimatedStart) return db;

  return {
    ...db,
    state: {
      ...db.state,
      purse: {
        ryo,
        history: [...before.history, ...added].slice(-HISTORY_LIMIT),
        ...(estimatedStart ? { estimatedStart: true } : {}),
      },
    },
  };
}

function cleanReason(reason: string, amount: number) {
  const text = reason.trim().replace(/\s+/g, ' ').replace(/[.]+$/, '');

  if (text.length >= 2) return text.charAt(0).toUpperCase() + text.slice(1, 80);

  return amount < 0 ? 'Spent' : 'Received';
}

/** The narrator's and tracker's line in CURRENT STATE. */
export function formatPurseLine(db: AppDatabase) {
  const { ryo } = purseOf(db);
  const note =
    ryo === 0
      ? ' (empty: Kan cannot pay for anything himself)'
      : ryo < LOW_PURSE_RYO
        ? ' (nearly empty)'
        : '';

  return `Purse: ${formatRyo(ryo)}${note}`;
}

/** "4,000 ryō" (the same form as the bingo books in reputation.ts). */
export function formatRyo(amount: number) {
  return `${amount.toLocaleString('en-US')} ryō`;
}

/** "+1,200 ryō" / "−500 ryō", for the Kan tab. */
export function formatChange(change: number) {
  return `${change < 0 ? '−' : '+'}${formatRyo(Math.abs(change))}`;
}

/** What the purse looks like, in a few words, for the Kan tab. */
export function purseFeel(ryo: number) {
  if (ryo === 0) return 'Empty';
  if (ryo < LOW_PURSE_RYO) return 'Nearly empty';
  if (ryo < 20_000) return 'Enough for the road';
  if (ryo < 200_000) return 'A comfortable sum';
  if (ryo < 2_000_000) return 'A small fortune';

  return 'A fortune';
}

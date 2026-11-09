/**
 * The player's money (`state.purse`): how much they carry, in the world's
 * currency, and what moved it.
 *
 * The narrator sees one Purse line in CURRENT STATE and the world's price
 * guide; the state tracker reports every change to the player's own money
 * (`money`) and, when the prose states the total, the total
 * (`money_counted`). Someone else paying for them changes nothing.
 */

import type { AppDatabase, CalendarDate, PurseEntry, PurseState, WorldDefinition } from './types';

/** Changes kept for the You tab, newest last. */
const HISTORY_LIMIT = 40;
/** No single change or total goes past this (a sanity cap on the tracker). */
const MAX_AMOUNT = 1_000_000_000;

type Currency = Pick<WorldDefinition['currency'], 'name' | 'symbol'>;

const FALLBACK_CURRENCY: Currency = { name: 'money' };

export function currencyOf(db: Pick<AppDatabase, 'world'> | null | undefined): Currency {
  return db?.world?.currency?.name ? db.world.currency : FALLBACK_CURRENCY;
}

/** The world's price scale, for the narrator and the tracker. Empty when the player wrote none. */
export function priceGuideOf(db: Pick<AppDatabase, 'world'>): string {
  return db.world?.currency?.priceGuide?.trim() ?? '';
}

/** What the player started with (their sheet), so "nearly empty" scales with the world's money. */
function startingAmount(db: AppDatabase) {
  const money = db.state.player?.money;
  return typeof money === 'number' && money > 0 ? money : 0;
}

/** Under this the narrator is told the purse is nearly empty: a fifth of what the player started with. */
export function lowPurseAmount(db: AppDatabase) {
  return Math.max(1, Math.round(startingAmount(db) / 5));
}

export function startingPurse(amount = 0, estimated = false): PurseState {
  return { amount: clampAmount(amount), history: [], ...(estimated ? { estimatedStart: true } : {}) };
}

/** Repairs a stored purse. */
export function normalizePurse(value: unknown, fallbackAmount = 0): PurseState {
  if (!value || typeof value !== 'object') return startingPurse(fallbackAmount, true);

  const purse = value as Partial<PurseState>;
  const raw = purse.amount;
  const amount = typeof raw === 'number' && Number.isFinite(raw) ? clampAmount(raw) : clampAmount(fallbackAmount);
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

  return { amount, history, ...(purse.estimatedStart ? { estimatedStart: true } : {}) };
}

export function purseOf(db: AppDatabase): PurseState {
  return db.state.purse ?? startingPurse(startingAmount(db), true);
}

function clampAmount(amount: number) {
  return Math.max(0, Math.min(MAX_AMOUNT, Math.round(amount)));
}

/** A number the tracker wrote, as a number ("-1,200", "$500", "500 dollars" and 500 all work). */
export function readAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  if (typeof value !== 'string') return null;

  const match = value.replace(/[,\s_]/g, '').replace(/^([+\-−]?)[^\d+\-−]+/, '$1').match(/^([+\-−]?)(\d+(?:\.\d+)?)/);

  if (!match) return null;

  const amount = Math.round(Number(match[2]));

  return match[1] === '-' || match[1] === '−' ? -amount : amount;
}

export type MoneyChange = { amount: number; reason: string };

/**
 * Applies this turn's money changes, then the total if the prose stated one.
 * A payment can't take the player below nothing: they pay what they have.
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
  let amount = before.amount;
  const added: PurseEntry[] = [];

  for (const change of changes ?? []) {
    const wanted = Math.max(-MAX_AMOUNT, Math.min(MAX_AMOUNT, Math.round(change.amount)));
    // Paying more than they have: they pay what they have.
    const applied = wanted < 0 ? Math.max(wanted, -amount) : wanted;

    if (applied === 0) continue;

    amount = clampAmount(amount + applied);
    added.push({ date, change: applied, reason: cleanReason(change.reason, applied) });
  }

  let estimatedStart = before.estimatedStart;

  if (hasCount) {
    const total = clampAmount(counted!);

    if (total !== amount) {
      added.push({ date, change: total - amount, reason: 'You counted what you have', counted: true });
      amount = total;
    }

    // Once the player has counted their money, the starting guess no longer matters.
    estimatedStart = undefined;
  }

  if (added.length === 0 && estimatedStart === before.estimatedStart) return db;

  return {
    ...db,
    state: {
      ...db.state,
      purse: {
        amount,
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
  const { amount } = purseOf(db);
  const note =
    amount === 0
      ? ' (empty: you cannot pay for anything yourself)'
      : amount < lowPurseAmount(db)
        ? ' (nearly empty)'
        : '';

  return `Purse: ${formatMoney(amount, currencyOf(db))}${note}`;
}

/** "$600" with a symbol, else "600 dollars". */
export function formatMoney(amount: number, currency: Currency = FALLBACK_CURRENCY) {
  const number = amount.toLocaleString('en-US');

  return currency.symbol?.trim() ? `${currency.symbol.trim()}${number}` : `${number} ${currency.name}`;
}

/** "+$1,200" / "−500 dollars", for the You tab. */
export function formatChange(change: number, currency: Currency = FALLBACK_CURRENCY) {
  return `${change < 0 ? '−' : '+'}${formatMoney(Math.abs(change), currency)}`;
}

/** What the purse looks like, in a few words, for the You tab (scaled to what the player started with). */
export function purseFeel(db: AppDatabase) {
  const { amount } = purseOf(db);
  const start = Math.max(1, startingAmount(db));

  if (amount === 0) return 'Empty';
  if (amount < lowPurseAmount(db)) return 'Nearly empty';
  if (amount < start * 2) return 'Getting by';
  if (amount < start * 10) return 'Comfortable';
  if (amount < start * 100) return 'Well off';

  return 'A fortune';
}

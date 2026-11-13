// Daily-word and seed helpers. Pure functions; "now" is always passed in for testability.

/** Day #1 of the daily puzzle (local calendar date). */
export const EPOCH = { year: 2026, month: 11, day: 1 }; // month is 1-based

const MS_PER_DAY = 86_400_000;

/**
 * Days since EPOCH using the player's local calendar date (so the word
 * changes at local midnight). Uses UTC arithmetic on the calendar date so
 * daylight-saving shifts never skip or repeat a day.
 * @returns {number} 1-based puzzle number
 */
export function dayNumber(now = new Date()) {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const epoch = Date.UTC(EPOCH.year, EPOCH.month - 1, EPOCH.day);
  return Math.floor((today - epoch) / MS_PER_DAY) + 1;
}

/**
 * Map a puzzle number to an index in the answers list. A fixed multiplier
 * walks the list in a scrambled but deterministic order, so it's not just
 * the raw list order. The answers list length (2309) is prime, so every
 * multiplier gives a full cycle before repeating.
 */
export function dailyAnswerIndex(day, listLength) {
  const MULT = 1013;
  const OFFSET = 271;
  const n = ((day * MULT + OFFSET) % listLength + listLength) % listLength;
  return n;
}

/** Milliseconds until the next local midnight. */
export function msUntilNextDay(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * Parse a user-entered seed. Returns an integer index into the answers
 * list, or null if the input isn't a whole number in range.
 */
export function parseSeed(input, listLength) {
  const text = String(input).trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n < listLength ? n : null;
}

export function randomSeed(listLength, rand = Math.random) {
  return Math.floor(rand() * listLength);
}

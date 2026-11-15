// Play-time clock for InfiniMode. Plain data so it can be saved with the game:
// { ms, since } — ms banked so far, since = when the running stretch started
// (Date.now()), or null while stopped. Time only counts while the page is
// visible, so a game left open overnight doesn't show 9 hours.

export const newClock = () => ({ ms: 0, since: null });

export function startClock(clock, now) {
  return clock.since == null ? { ...clock, since: now } : clock;
}

export function stopClock(clock, now) {
  return clock.since == null ? clock : { ms: clock.ms + Math.max(0, now - clock.since), since: null };
}

export const clockMs = (clock, now) => (clock ? clock.ms + (clock.since == null ? 0 : Math.max(0, now - clock.since)) : 0);

/** 0:07, 2:14, 1:02:09 */
export function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

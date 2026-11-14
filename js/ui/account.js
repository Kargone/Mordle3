// Account row in Settings and the sync card in the results sheet.

const $ = (id) => document.getElementById(id);

function setStatus(el, text, kind = '') {
  el.className = `sync-status${kind ? ' ' + kind : ''}`;
  el.lastElementChild.textContent = text;
}

/**
 * @param {{onSignIn: () => Promise<void>, onSignOut: () => Promise<void>}} actions
 */
export function createAccountUI({ onSignIn, onSignOut }) {
  let cloud = { status: 'off' };
  let busy = false;

  async function run(action, btn) {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    try { await action(); } finally { busy = false; btn.disabled = false; update(cloud); }
  }
  $('signin-btn').addEventListener('click', (e) => run(onSignIn, e.currentTarget));
  $('nudge-signin').addEventListener('click', (e) => run(onSignIn, e.currentTarget));
  $('signout-btn').addEventListener('click', (e) => run(onSignOut, e.currentTarget));

  /** Settings row. */
  function update(next) {
    cloud = next;
    const row = $('account-row');
    row.hidden = cloud.status === 'off';
    if (row.hidden) return;

    const google = cloud.status === 'google';
    const avatar = $('account-avatar');
    avatar.textContent = google ? (cloud.name || '?').trim().charAt(0).toUpperCase() : '?';
    avatar.classList.toggle('on', google);
    $('account-name').textContent = google ? cloud.name : 'Not signed in';
    $('signin-btn').hidden = google || cloud.status === 'error';
    $('signin-btn').disabled = busy || cloud.status === 'connecting';
    $('signout-btn').hidden = !google;

    const status = $('account-status');
    if (cloud.status === 'error') setStatus(status, "Can't reach sync right now");
    else if (cloud.status === 'connecting') setStatus(status, 'Connecting…');
    else if (cloud.pending) setStatus(status, google ? 'Waiting to sync' : 'Not synced', google ? 'wait' : '');
    else if (google) setStatus(status, 'Synced', 'on');
    else setStatus(status, 'Not synced');
  }

  /**
   * Results sheet card. Shown for Daily and Random once you've played a game.
   * @param {{mode: string, played: number, streak: number}} ctx
   */
  function updateSheet({ mode, played, streak }) {
    const relevant = mode !== 'infini' && played > 0;
    $('sync-nudge').hidden = !(relevant && cloud.status === 'anon');
    $('sync-done').hidden = !(relevant && cloud.status === 'google');
    $('sync-done').querySelector('.sync-status').className = `sync-status ${cloud.pending ? 'wait' : 'on'}`;
    $('sync-done').querySelector('.sync-status span').textContent = cloud.pending ? 'Waiting to sync' : 'Synced to your Google account';
    $('nudge-title').textContent = streak >= 2 ? `Keep your ${streak}-day streak` : 'Sync your stats';
    if (mode === 'random' && streak >= 2) $('nudge-title').textContent = `Keep your ${streak}-win streak`;
  }

  return { update, updateSheet };
}

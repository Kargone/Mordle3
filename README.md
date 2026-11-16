# Mordle

A five-letter word-guessing game with a daily puzzle, shareable random seeds, and an endless **InfiniMode**. It's a full rebuild of [Mordle-2](https://github.com/Kargone/Mordle-2) with modern code and a new look.

Plain HTML, CSS and JavaScript (ES modules). **No build step and no dependencies.** Firebase loads from Google's CDN only when sync is configured.

## Features

- **Daily:** one word per day (changes at local midnight), the same for everyone.
- **Random:** a random word, or enter a seed (0–2308) to play a specific word. Share links include the seed (`?seed=1795`).
- **InfiniMode:** unlimited guesses. The board scrolls as you go. A clock starts with your first letter (it pauses while the game is in the background), and stats track words solved, average and fewest guesses, and your fastest time.
- **Battle (needs Firebase):** 2–8 players take turns on one shared board with a turn timer. Type your next guess while you wait. First to find the word wins the round. Share a room link or pick a room from the lobby. Let the timer run out twice in a row and you sit out your next turn.
- **Co-op (a Battle room setting):** everyone on one team, one shared board. No turns: anyone can submit a guess at any time, guesses are unlimited, and the team record tracks words solved, guesses and time.
- **Hard mode:** any letters you've found must be used in later guesses.
- **Stats and streaks** for Daily and Random, with a guess-distribution chart.
- **Share** your result as an emoji grid.
- **Themes:** Dark and Light (or follow the system setting), plus a high-contrast option.
- **Saving:** your game picks up where you left off after a refresh (saved in the browser).
- **Sync (optional):** sign in with Google to keep stats, streaks and settings on every device (Firebase).
- **Leaderboards (needs Firebase):** Google-signed-in players are listed under their Battle name on four boards: Today's daily (fewest guesses, then fastest), Daily streaks, InfiniMode words solved and Battle wins. The results sheet shows your rank after each game; the Leaderboard tab is in the stats sheets. Anyone can look; **Hide me** takes you off.
- **Accessibility:** keyboard play, screen-reader labels, and reduced-motion support.

## Run locally

Any static file server works. ES modules don't load from `file://`.

```sh
npm start              # npx serve
# or
python -m http.server 8000
```

## Tests

```sh
npm test               # node --test, no install needed (Node 18+)
```

The tests cover scoring with repeated letters, hard-mode rules, the daily rollover, streak math and share text.

## Deploy

**Vercel:** import the repo and choose Framework preset **Other**. Leave the build command empty and set the output directory to the repo root.

**Netlify:** import the repo, leave the build command empty and set the publish directory to `.`.

## Sync (Firebase)

Sync is off until `js/firebase-config.js` has a config. Without it the game works exactly the same, saving to the browser only.

1. Create a Firebase project and add a **Web app**. Copy its `firebaseConfig` object into `js/firebase-config.js`. These values are public by design.
2. **Authentication → Sign-in method:** enable **Anonymous** and **Google**.
3. **Authentication → Settings → Authorized domains:** add your Netlify domain.
4. **Firestore Database:** create a database (production mode), then paste `firestore.rules` into the **Rules** tab and publish. Re-publish whenever `firestore.rules` changes.
5. Optional, **Firestore Database → Time-to-live (TTL)** (it may be under the database's settings): create a policy with collection group `rooms` and timestamp field `expireAt`. Abandoned battle rooms are then deleted about a day after their last activity. Without it they just sit there, hidden from the lobby.

How it works: every player is signed in anonymously in the background and gets a `users/{uid}` document. Signing in with Google links that account. If the Google account already has stats from another device, this device's stats are merged in once (counts added, best streak kept, a daily played on both devices counted once). Finished games go into a small queue and are applied to the cloud stats in a transaction, so devices never overwrite each other and games played offline upload later. Today's daily also syncs: submitted guesses are saved as you play, and whichever device is further along wins, so you can start on your phone and finish on your laptop. Settings (hard mode, theme, contrast) follow the most recent change. Signing out clears stats from this device; they stay in the Google account.

## Battle mode

Rooms live in Firestore at `rooms/{code}` (4-character codes like `KQ7P`; links are `?battle=KQ7P`). Each action (join, guess, skip, next round, leave) runs in a transaction through a pure function in `js/battle/logic.js`, so players acting at the same time can't overwrite each other.

- **Turns:** the current player's device ends their own turn when the timer runs out; everyone else skips it 3 seconds later as a backup (e.g. if that phone went to sleep). Each timeout adds to the player's `misses`; a guess resets it. Two in a row sets `sitOut`, and the next hand-off passes over that player once (`turn.satOut` lists who was passed, for the toasts). Both reset each word; skipping an away player doesn't count.
- **Presence:** players who disconnect are skipped automatically. Switching away from the game or closing it marks you away at once, and your turns are skipped until you come back. A dropped connection is caught by heartbeats (every 10 seconds; quiet for 30 seconds = gone). If the host is gone, the next player becomes host; a host who only switched apps for a moment keeps the room.
- **Cleanup:** every room write sets `expireAt` to 24 hours ahead (heartbeats too, so live rooms never expire). The TTL policy from setup step 5 deletes rooms past that time; Firestore usually does this within a day of expiry.
- **Rounds:** 1–10 or ∞ (the default). An unlimited match goes on until the host taps **End match** on the round sheet.
- **Co-op:** `settings.game = 'coop'`. No turn object; any player in the room can append a guess (a word already on the board is rejected, since teammates often send the same one at once). Each solved word is recorded once per player as a team result.
- **Stats:** when a match ends, each player's device records it once (matches, outright wins, rounds won, win streak) plus a win–loss record against each opponent, keyed by their account so name changes don't split it. The 30 most recent rivals are kept. Battle stats sync with the rest of your stats.
- **Trust:** there's no server checking guesses (that needs Cloud Functions on the Blaze plan). The rules keep strangers out of rooms and stop non-hosts changing settings, but players in a room could cheat. Fine for playing with friends.

## Leaderboards

- **Data:** `leaders/{uid}` holds a public summary of each Google player's stats (name, daily streak, InfiniMode and Battle numbers), rewritten 1.5 seconds after their stats change. `days/{day}/scores/{uid}` holds that day's daily result, posted once; only its name can change later. Hide me deletes both, and the setting syncs.
- **Ranking:** each board sorts on one field (`score` for today = guesses × 10,000,000 + ms, so fewer guesses wins and time breaks ties), so Firestore's automatic indexes cover every query and no composite index is needed. The rank card uses count queries, which cost one read per 1,000 entries.
- **Daily time:** Daily now runs the same clock as InfiniMode (not shown on screen). A daily continued from another device isn't posted from this one, since its time would be wrong.
- **Streaks:** an entry's streak is as of that player's last daily. One that has lapsed counts as 0 on the board.
- **Trust:** as with Battle, nothing checks results on a server. The rules require a Google-linked account, let each player write only their own entry, and reject impossible values; a determined player could still post a fake score.

## Project layout

```
index.html          page shell and dialogs
css/                tokens (theme), layout, board, keyboard, dialogs, animations
js/game.js          game rules (no page code)
js/daily.js         daily word and seed helpers
js/stats.js         stats and streaks
js/share.js         share text
js/storage.js       localStorage wrapper
js/sync.js          merge rules for syncing devices
js/cloud.js         Firebase sign-in and Firestore sync
js/firebase-config.js  Firebase config (null = sync off)
js/words.js         answer and guess word lists
js/ui/              board, keyboard, toasts, results sheet, account, icons, motion
js/battle/          battle rules (logic.js), Firestore rooms (net.js), screens (view.js), controller
js/main.js          wires everything together
tests/              unit tests
docs/               design decisions
firestore.rules     Firestore security rules
TODO.md             roadmap (battle mode, Firebase) and a manual test checklist
```

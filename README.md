# Mordle

A five-letter word-guessing game with a daily puzzle, shareable random seeds, and an endless **InfiniMode**. It's a full rebuild of [Mordle-2](https://github.com/Kargone/Mordle-2) with modern code and a new look.

Plain HTML, CSS and JavaScript (ES modules). **No build step and no dependencies.** Firebase loads from Google's CDN only when sync is configured.

## Features

- **Daily:** one word per day (changes at local midnight), the same for everyone.
- **Random:** a random word, or enter a seed (0–2308) to play a specific word. Share links include the seed (`?seed=1795`).
- **InfiniMode:** unlimited guesses. The board scrolls as you go.
- **Battle (needs Firebase):** 2–8 players take turns on one shared board with a turn timer. Type your next guess while you wait. First to find the word wins the round. Share a room link or pick a room from the lobby.
- **Hard mode:** any letters you've found must be used in later guesses.
- **Stats and streaks** for Daily and Random, with a guess-distribution chart.
- **Share** your result as an emoji grid.
- **Themes:** Dark and Light (or follow the system setting), plus a high-contrast option.
- **Saving:** your game picks up where you left off after a refresh (saved in the browser).
- **Sync (optional):** sign in with Google to keep stats, streaks and settings on every device (Firebase).
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

- **Turns:** the current player's device ends their own turn when the timer runs out; everyone else skips it 3 seconds later as a backup (e.g. if that phone went to sleep).
- **Presence:** each player sends a heartbeat every 20 seconds. Anyone quiet for 60 seconds is skipped in the turn order, and if the host goes quiet the next player becomes host.
- **Cleanup:** every room write sets `expireAt` to 24 hours ahead (heartbeats too, so live rooms never expire). The TTL policy from setup step 5 deletes rooms past that time; Firestore usually does this within a day of expiry.
- **Trust:** there's no server checking guesses (that needs Cloud Functions on the Blaze plan). The rules keep strangers out of rooms and stop non-hosts changing settings, but players in a room could cheat. Fine for playing with friends.

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

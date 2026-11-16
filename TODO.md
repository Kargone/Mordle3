# Mordle3 TODO

## Later (not part of the first release)

- [x] **Battle mode**: 2–8 players take turns on one shared board (turn timer, skip on timeout, type ahead). First to find the word wins the round. Room links + public lobby browser.
  - [x] Publish the updated `firestore.rules` (adds `rooms`); tested against the real project
  - [ ] Play a real game across two phones (timing, backgrounding, co-op)
  - [x] Rooms carry `expireAt` (24h after last activity) for a Firestore TTL policy
  - [ ] Create the TTL policy in the console (README → Sync step 5)
  - [x] Battle stats: matches, win %, rounds won, best streak, and a record against each rival (stats button in Battle)
  - [x] Rounds default to ∞ (unlimited); the host ends the match from the round sheet
  - [x] Co-op: a room setting; one shared board, anyone guesses any time, unlimited guesses, team record
  - [ ] Ideas: quick rematch with new players, emoji reactions
- [x] **Firebase sync**
  - [x] **Set up the Firebase project** (see README → Sync)
  - [x] Auth: anonymous sign-in, with optional Google sign-in to link devices
  - [x] Sync stats, streaks and settings across devices (Firestore). Merge with existing localStorage data on first sign-in.
  - [x] Sync the in-progress daily, so a half-played daily continues on another device
  - Reminder: re-publish `firestore.rules` whenever it changes (Firestore → Rules)
  - [x] Real-time backend for battle mode: rooms in Firestore with live listeners, heartbeat presence
  - [x] Security rules so players can only write their own data
  - [ ] (Needs Blaze plan) validate battle guesses on the server with Cloud Functions so results can't be faked
  - Note: `js/storage.js` and `js/stats.js` are kept separate so a Firebase-backed store can replace or wrap them.
- [x] Scroll bar UI revamp: hidden bar + "↑ N earlier rows" jump pill
- [x] InfiniMode scrolls to the very bottom
- [x] InfiniMode time and guess stats, with a live clock
- [x] Ctrl+Backspace / hold ⌫ clears the word
- [x] **Leaderboards** for Google-signed-in players: Today, Daily streaks, InfiniMode, Battle; rank card after each game
  - [ ] Publish the updated `firestore.rules` (adds `leaders` and `days/{day}/scores`)
  - [ ] Check with a real Google account: entry appears, Hide me removes it

## Checklist: things to check by hand

- [x] Win, loss, invalid word, too-short guess
- [x] Duplicate-letter coloring is correct (e.g. guess LLAMA when the answer is HELLO)
- [x] Hard mode blocks bad guesses and can't be turned on after the first guess
- [x] Daily word changes at local midnight; the countdown is right
- [x] Refreshing mid-game resumes it
- [x] Custom seed and New Game work; InfiniMode scrolls past 6 rows
- [x] Stats and streaks update correctly
- [x] Share text pastes nicely in Discord/iMessage
- [x] Light, dark and high-contrast themes all look right
- [x] Works on your phone (iOS Safari and Android Chrome) and on desktop
- [x] Physical keyboard and on-screen keyboard both work
- [x] The reduced-motion setting turns off animations
- [x] Help dialog shows on the first visit only
- [x] Deployed site on Netlify loads with no console errors

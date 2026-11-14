# Mordle3 TODO

## Later (not part of the first release)

- [ ] **Battle mode**: head-to-head races where two or more players get the same word. First to solve wins; ties go to fewer guesses.
- [ ] **Firebase sync**
  - [x] **Set up the Firebase project** (see README → Sync)
  - [x] Auth: anonymous sign-in, with optional Google sign-in to link devices
  - [x] Sync stats, streaks and settings across devices (Firestore). Merge with existing localStorage data on first sign-in.
  - [x] Sync the in-progress daily, so a half-played daily continues on another device
  - [ ] Re-publish `firestore.rules` whenever it changes (Firestore → Rules)
  - [ ] Real-time backend for battle mode: lobbies, presence, live opponent progress (Firestore listeners or Realtime Database)
  - [ ] Security rules so players can only write their own data; validate battle results on the server (Cloud Functions)
  - Note: `js/storage.js` and `js/stats.js` are kept separate so a Firebase-backed store can replace or wrap them.
- [x] Scroll bar UI revamp: hidden bar + "↑ N earlier rows" jump pill
- [x] InfiniMode scrolls to the very bottom

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

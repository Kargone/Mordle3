# Mordle

A five-letter word-guessing game with a daily puzzle, shareable random seeds, and an endless **InfiniMode**. It's a full rebuild of [Mordle-2](https://github.com/Kargone/Mordle-2) with modern code and a new look.

Plain HTML, CSS and JavaScript (ES modules). **No build step and no dependencies.**

## Features

- **Daily:** one word per day (changes at local midnight), the same for everyone.
- **Random:** a random word, or enter a seed (0–2308) to play a specific word. Share links include the seed (`?seed=1795`).
- **InfiniMode:** unlimited guesses. The board scrolls as you go.
- **Hard mode:** any letters you've found must be used in later guesses.
- **Stats and streaks** for Daily and Random, with a guess-distribution chart.
- **Share** your result as an emoji grid.
- **Themes:** Dark and Light (or follow the system setting), plus a high-contrast option.
- **Saving:** your game picks up where you left off after a refresh (saved in the browser).
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

## Project layout

```
index.html          page shell and dialogs
css/                tokens (theme), layout, board, keyboard, dialogs, animations
js/game.js          game rules (no page code)
js/daily.js         daily word and seed helpers
js/stats.js         stats and streaks
js/share.js         share text
js/storage.js       localStorage wrapper
js/words.js         answer and guess word lists
js/ui/              board, keyboard, toasts, results sheet, icons, motion
js/main.js          wires everything together
tests/              unit tests
docs/               design decisions
TODO.md             roadmap (battle mode, Firebase) and a manual test checklist
```

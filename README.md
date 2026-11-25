# Flowbound — an IGCSE flowchart RPG

Defeat three bosses by answering flowchart questions:

| Boss | Topic | Question types |
| --- | --- | --- |
| The Gatekeeper | Symbols & sequence | name the symbol, trace, fill the boxes, **draw the flowchart** |
| The Forking Hydra | Selection (decisions) | trace, fill, draw |
| The Endless Loop | Iteration (loops) | trace, fill, draw |

* **Draw** questions open a flowchart editor: add Start/Stop, Input/Output, Process and Decision symbols, drag them, connect arrows, and type in the boxes (`Total ← Total + X`, `INPUT X`, `OUTPUT "PASS"`, `X > 5?`). Your flowchart is **run** against test inputs, so any correct design passes.
* Every player signs in with a **username + 4-digit PIN**. Correct answers earn XP (faster = more), bosses give bonus XP, and XP sets your **rank**: Novice → Apprentice → Pathfinder → Navigator → Architect → Master → Grandmaster. The **Leaderboard** ranks all players.

Plain HTML/CSS/JS — no build step. Open `index.html` or host the folder anywhere.

## Deploy on GitHub Pages

1. Create a new repository on GitHub (e.g. `flowbound`) and push this folder to it.
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`, **Save**.
3. After a minute the game is live at `https://<your-username>.github.io/flowbound/`.

## Shared online leaderboard (optional)

Without setup the leaderboard is stored in each browser, so every computer has its own. To share one leaderboard between all students:

1. Go to <https://console.firebase.google.com>, **Add project** (Analytics not needed).
2. **Build → Firestore Database → Create database** (production mode, any region).
3. In the **Rules** tab paste the contents of [`firestore.rules`](firestore.rules) and **Publish**.
4. **Project settings (⚙) → General → Your apps → Web (`</>`)** → register an app. Copy `projectId` and `apiKey`.
5. Put them in [`js/config.js`](js/config.js), commit and push.

The game talks to Firestore over its REST API — no SDK, no login. The rules only allow well-formed player records, never let XP go down, and stop a record's PIN from being changed. The PIN is a light classroom lock, not real security: don't reuse a real password.

## Development

```
node tools/validate.js     # every challenge compiles and every model answer passes its tests
node tools/smoke.mjs       # headless playthrough in Microsoft Edge, screenshots in tools/shots/
```

Challenges live in [`js/data/questions.js`](js/data/questions.js). Flowcharts are written as nested lists and laid out automatically:

```js
add('sel', 'Selection', 'draw', {
  prompt: 'INPUT a mark. OUTPUT "PASS" if it is 50 or more, otherwise "FAIL".',
  solution: ['START', 'INPUT Mark', { if: 'Mark >= 50?', yes: ['OUTPUT "PASS"'], no: ['OUTPUT "FAIL"'] }, 'STOP'],
  tests: [T(75), T(50), H(49)],          // H(...) = hidden test; expected outputs come from running the solution
  hint: 'Use a decision Mark >= 50?',
});
```

Also available: `{ while: 'C <= N?', do: [...] }`, `{ repeat: [...], until: 'X > 20?' }`, and `'[[answer]]'` for a box the player must fill in.

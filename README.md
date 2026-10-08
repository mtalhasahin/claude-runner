# Claude Runner

A small endless runner that plays in a side pane while Claude works. It opens when a turn
starts, follows what Claude is doing (working, waiting for a tool, thinking), and stops when
Claude answers. It keeps a best score and a few counts across sessions.

Built as a Claude Code **mod**: a plugin whose behaviour lives in a function-hooks module
(`register(on, options)`, hooks of the shape `($, event, next)`). Early access: the API may
change between Claude Code releases without notice. Written against **Claude Code 2.1.293**
(started on 2.1.278; see *Moving to 2.1.293* below).

The plugin is named `runner` (the game is still called Claude Runner): from 2.1.293 a
third-party plugin's name may not start with `claude-`.

> Status: **Phase 5**, all five phases built. The game follows Claude's turn, shows score,
> best and session time, stores its statistics, and has combos, turn milestones, easter eggs
> and a little landing dust. Sound is the one Phase 5 item left out (see the limits).

## Playing

```
CLAUDE RUNNER
Score 00184  Best 06210  Session 00:18
                  Bug
   [o]            █
   / \       ██
──────────────────────────────────────
.      .   `  .      .`     .    ` .
              Cleared 4
Claude is working...
```

| Key | What it does |
|---|---|
| Space or ↑ | jump; resume a pause; retry after a hit |
| P | pause / resume |

The keys work only while Claude is working: the run starts with Claude's turn and ends with
it. `Session` is Claude's turn time, and it keeps counting while the runner is down.

Click the game first: keys reach it only while it has the focus, and Escape hands them back
to the prompt. The obstacles are `Bug`, `TODO`, `Error`, `Timeout`, `Exception` and
`Merge Conflict`. The run speeds up from 14 to 30 columns a second over 90 seconds and the
gaps tighten; the score grows about 10 points a second at the start. A test bot that jumps
with a fixed lead time survives two minutes on every seed tried, so every course is
clearable.

### Extras

- **Combos.** Clearing 5, 10, then every 25 obstacles in a row without a hit shows
  `COMBO x10  +100` and adds 10 points per obstacle in the streak, at most 250 a combo (x25
  and every one after), so a long turn's streak cannot outscore the run itself.
- **Easter eggs.** About one obstacle in 33 is a rare gold one: `404 Bug` (+100),
  `NullReferenceException` (+150), `Merge Conflict x3` (+200) or `Production Friday` (+250).
  Clearing it shows its name and adds the bonus.
- **Milestones.** When Claude's turn runs long, the message line says so for four seconds:
  30 s *Claude is warming up...*, 1 min *Deep thinking...*, 2 min *This is getting
  serious...*, 5 min *Are we building an operating system?* The `milestones` option turns
  them off.
- **Landing dust**, a stride animation, `[x]` on a hit, and a blinking GAME OVER when
  Claude's turn fails.
- **Any pane width.** Every row is exactly as wide as the pane; the score line drops to
  `Score · Best · 01:24` and then `S · B · 01:24` when it is narrow.

The message line shows one thing at a time, the most notable first: a combo or easter egg
just now, then a milestone, then how to play (the first 4 s), then the count.

### Statistics

```
/runner stats

Claude Runner Stats

Games:           127
Best Score:      8420
Claude Sessions: 86
Waiting Time:    04h 21m
```

- **Games**: runs that ended, by a hit, by Claude's answer or by Claude's failure. A run
  already down when Claude answers counts once.
- **Claude Sessions**: main-loop turns that ended, and **Waiting Time** their total length.

They live in the plugin's own `$.store` (a JSON file under the Claude configuration
directory). Only these four numbers are kept: no prompt, file content, tool output, path or
key. The game sends the hooks module nothing but a finished run's score, and the hooks module
checks that post's shape and bounds the score before counting it.

---

## Running it

```bash
claude --plugin-dir C:\Users\talha\source\repos\claude-runner
```

Then type a prompt. On a wide enough terminal the pane opens on its own; anywhere, `/runner`
opens or closes it.

Function hooks load without `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` on 2.1.278 (checked with
`--debug-file`: the log reads `hooks module claude-runner@inline loaded`); 2.1.293 loads the
module too. An older or differently configured build may still need the variable.

Options (in `~/.claude/settings.json` under `pluginConfigs["runner"].options`, or the
`/config` menu):

| Option | Default | What it does |
|---|---|---|
| `autoOpen` | `true` | Open the pane when a turn starts. |
| `closeOnComplete` | `true` | Close the pane 5 s after Claude answers, when it opened on its own at that turn's start. A pane opened with `/runner` stays, and so does one showing an error. A new turn within the 5 s keeps it up. |
| `milestones` | `true` | Show the long-turn messages at 30 s, 1, 2 and 5 minutes. |

`closeOnComplete` is the spec's "minimize when Claude is done": the pane API has no collapse,
so the pane closes instead, and `autoOpen` brings it back with the next turn. On a terminal
too narrow for a pane opened unasked (under 144 columns, 110 once you have opened it), it
will not come back on its own; `/runner` opens it there, and a pane you opened stays.

### Development

```bash
claude plugin validate .
claude plugin test .
npx -p typescript@5 tsc -p tsconfig.json
```

The API's declarations are in `.claude-plugin/types/`. Claude Code writes them there itself
each time it loads the mod (and keeps them out of git with their own `.gitignore`), so they
always match the installed build. `tsconfig.json` extends the `tsconfig.json` written beside
them.

### Moving to 2.1.293

Claude Code updated itself from 2.1.278 to 2.1.293 while Phase 4 was being built. What
changed for this mod:

- `/plugin-types` is gone; the types are written to `.claude-plugin/types/` on load.
- A plugin name starting with `claude-` is refused: the plugin became `runner`, and the
  pane id with it. The store moves with the name, so statistics start fresh.
- `$.ui.open` now answers `{ isPlaced }`; the mod reads that instead of `$.ui.panes()`.
- `claude plugin validate` now lists *gating hooks without `.catch`* (`tool.call`,
  `command.run`, `ui.close` here). It is a note, not an error: a hook that fails without one
  is skipped and the chain goes on without it.

---

## How the mod reads Claude's state

There is no single "Claude is busy" event. The state is derived from the turn lifecycle and the
tool calls inside it, on the **main loop only**: a subagent's tool calls and its
`turn.complete` (which carry an `agentId`) do not move the state.

| Engine event | Condition | Session state | Game |
|---|---|---|---|
| (load) | | `IDLE` | waiting, "Waiting for Claude..." |
| `turn.start` | | `WORKING` | a fresh run starts at once |
| `tool.call`, entering `next(event)` | main loop | `WAITING_FOR_TOOL` | the course runs at 70 % |
| `tool.call`, `next(event)` settled | no other tool still running | `WAITING_FOR_RESPONSE` | full speed again |
| `turn.complete` | `reason: 'answer'` | `COMPLETED` | halts; "Run over · Score N" (or "New best!"); the clock stops |
| `turn.complete` | `reason: 'aborted'` (Esc) | `COMPLETED` ("Interrupted") | halts |
| `turn.complete` | `reason: 'error'` or `'refusal'` | `ERROR` | `[x]`, GAME OVER blinks for 1.5 s |

Tools run in parallel, so the mod counts the calls in flight rather than keeping a flag.

The hooks module hands the game `{ seed, phase, turnNumber, turnElapsedMilliseconds,
bestScore }` as the `Client`'s props on every redraw. The surface module compares them with
what it last saw (`hooks/game/session-link.ts`) and moves the run along. The turn time comes
from the engine's clock at each redraw (so a pane opened mid-turn shows the real time) and is
counted on the frame clock between redraws; once the turn is over, the engine's duration is
final. A frame that changes nothing on screen (the runner down, Claude done) asks for no
redraw.

Possible refinements, not used yet:

- `turn.step` (an async-generator hook, `yield* next(event)`) marks each model request inside a
  turn, which would separate "the model is streaming" from "between steps".
- `tool.check` resolving to `decision: 'ask'` means a permission dialog is about to appear: a
  "Waiting for your permission" label.

## Which API pieces it uses

| Need | Mechanism |
|---|---|
| A side pane | `$.ui.open({ id, title, rows, columns })`, drawn by a `ui.render` hook on `{ component: 'Pane' }` whose `requestId` is the pane's id |
| Redraw on a state change | `$.ui.invalidate('ui.render')` |
| `/runner`, `/runner stats` | `$.command.register({ name, description, argumentHint, immediate: true })` in `session.start`, answered by a `command.run` hook; `immediate` lets it run while a turn is still going |
| Knowing the person closed it | `ui.close` hook, `event.origin.kind === 'person'` |
| The game loop and keys | a `Client` element: a surface module running on the drawing thread with its own frame clock (`surface.every`) and key listener (`surface.onKey`) |
| A finished run's score | `surface.post` in the game, a `ui.message` hook in the hooks module |
| Persistence | `$.store` |

## Limits of the current API

These come from the declarations in `.claude-plugin/types/` and from testing. Each one changes
something the original spec asked for.

- **The terminal only.** The desktop app does not draw plugin panes yet: the engine describes
  the pane over the wire, but the app does not implement that side of the protocol (found
  while building `waitroom`). The hooks still fire there, so the statistics still count.
- **No Canvas or DOM.** Hooks and surface modules run in an environment with neither. The
  game is drawn as a grid of character cells with `Box` and `Text`. That is the "terminal
  look" the spec asked for, but not Canvas.
- **Width is in columns, not pixels.** The pane asks for 40 body columns while docked, which is
  about 280-360 px at a usual terminal font. The person's own drag wins.
- **Opening on its own needs a wide terminal.** The engine leaves a pane a plugin opens unasked
  undrawn below 144 columns (110 once the person has opened that id themselves). When that
  happens the mod closes it again instead of letting it pop up later; `/runner` opens it at
  any width.
- **Keys reach the game only after a click on it.** That is how the spec's "never take the
  terminal's keyboard" rule is kept: the pane never asks for focus, and Space or P typed at
  the prompt stay in the prompt.
- **Escape never reaches the game.** The engine uses it to hand the keyboard back to the
  prompt. So Escape cannot close or minimize the pane. Close the pane with `/runner` or its
  close mark.
- **The Space key's name is not documented.** `ClientKeyEvent.key` is "a special key's name
  or the character typed"; the game takes both `' '` and `'space'`. The tests drive `' '`.
- **No sound on Windows or Linux.** `$.audio.play` plays a clip with `afplay` on macOS; the
  declarations say a Linux or Windows terminal, having no player, plays nothing. So the sound
  option was not built: on this machine it would be a switch that does nothing.
- **Two sessions at once share one store.** Each keeps its own copy and writes it whole, so
  two terminals running Claude at the same time can lose each other's counts.
- **A hot reload drops module state.** Saving a file under `hooks/` reloads the module: the
  current session state starts over at `IDLE`. What `$.store` holds survives.

## Layout

```
claude-runner/
├── .claude-plugin/
│   ├── plugin.json              manifest and the userConfig options
│   └── types/                   the API's declarations, written by Claude Code on load
├── hooks/
│   ├── hooks.json               names the hooks module
│   ├── register.ts              the hooks: turn, tool, pane, command, close, message
│   ├── session-state.ts         the state machine: event -> phase, status text  [PURE]
│   ├── names.ts                 ids, titles, sizes, store keys
│   ├── views/pane-view.tsx      the pane's tree, the game's Client in it       [PURE]
│   ├── storage/statistics.ts    what is stored, the post check, the report     [PURE]
│   └── game/
│       ├── runner-client.tsx    the Client surface module: frame clock, keys, drawing
│       ├── session-link.ts      Claude's phase -> start, slow, halt, crash; run ends  [PURE]
│       ├── game.ts              one run: jump, pause, step, collisions, combos [PURE]
│       ├── physics.ts           gravity, jump, landing                         [PURE]
│       ├── obstacle.ts          obstacle kinds, easter eggs, spawning, gaps    [PURE]
│       ├── milestones.ts        the long-turn messages                         [PURE]
│       ├── score.ts             speed, difficulty, points                      [PURE]
│       ├── renderer.ts          a run -> rows of styled character runs         [PURE]
│       └── random.ts            seeded generator                               [PURE]
├── tests/                       run with `claude plugin test .`
│   ├── register.test.ts         session state and the pane's open/close
│   ├── game.test.ts             physics, collisions, speed, score, clearability, combos, eggs, dust
│   ├── renderer.test.ts         milestones, message priority, narrow and wide panes
│   ├── session-link.test.ts     phase changes, turn clock, run ends, best score
│   ├── statistics.test.ts       stored values, post checking, the report
│   └── runner-client.test.ts    the game mounted through the engine: keys, frame clock, stats
└── tsconfig.json
```

This follows the official mods' layout (`.claude-plugin/plugin.json`, `hooks/hooks.json`,
TypeScript under `hooks/`) rather than the `src/` tree in the original spec.

# Working on Pedal Sim

How to run the site on your own computer, work in branches, and publish when a phase is ready.

## The idea

```
 phase/4-something ──●──●──●──┐          work happens here, runs locally
                              │ merge
 main ────●────●────●─────────●──►  GitHub Pages (public site)
```

* **`main` is the public site.** GitHub Pages only publishes `main`. Nothing reaches the live site until you merge into `main` and push.
* **Each phase gets its own branch** (`phase/4-modulation`, `phase/5-pcb-output`...). You and Claude work there, test locally, and commit as often as you like. Pushing a phase branch to GitHub backs it up but does **not** change the live site.
* **Branches are kept after merging**, so every phase stays available to go back to.

## One-time setup

1. Install **Node.js LTS** from [nodejs.org](https://nodejs.org) (default options are fine).
2. Check it worked: open a new terminal (VS Code: **Ctrl+`**) and run `node --version`. You should see `v20` or newer.

## Run it locally

Either:

* **Double-click `run-local.cmd`** in the `pedal-sim` folder. A window opens with the server, and your browser opens `http://localhost:8080/`.
* Or in a VS Code terminal in the `pedal-sim` folder: `npm start`, then open `http://localhost:8080/`.

Then:

* **Edit a file, save, refresh the browser.** No build step, no waiting. (The one exception: changes to the C++ in `engine/cpp/` need `.\engine\cpp\build.ps1` first; see `engine/cpp/README.md`.)
* The server window shows which **git branch** is running. From phase 4 on, the page header also shows a blue **Local preview · branch-name** badge (the public site never shows it).
* **Stop** the server with **Ctrl+C** in its window (or just close the window).
* **Run the tests** before publishing: `npm test` (all should pass). `npm run test:browser` also clicks through the real site in a hidden Chrome (one-time setup: `npm install`, then `npx playwright install chromium`).

Microphone / audio interface input works locally, because browsers treat `localhost` as secure.

## Start a new phase

In **GitHub Desktop**:

1. Make sure **Current branch** is `main` and there are no uncommitted changes (the Changes tab is empty).
2. **Current branch → New branch**. Name it `phase/<number>-<short-name>`, for example `phase/16-modulation`. Create it based on the **previous phase branch** (each phase builds on the one before; `main` only moves when a finished set of phases is published).
3. Click **Publish branch** (top bar). This creates the branch on GitHub as a backup.

Tell Claude which branch you are on. Claude edits the files in your `pedal-sim` folder, which is always whatever branch GitHub Desktop has checked out.

## While working

* **Commit often** on the phase branch: small summary of what changed, **Commit to phase/...**, then **Push origin**. Each commit is a restore point.
* Run it locally, try it, repeat.

## Two repositories: where work happens, and what the public sees

| Folder on your computer | GitHub repository | Visibility | What it holds |
|---|---|---|---|
| `pedal-sim-public` | `pedal-sim-dev` | always private | all the work: every phase branch and its full history |
| `pedal-sim-site` | `pedal-sim` | public when you choose | only finished versions, one clean commit each |

GitHub Pages runs from `pedal-sim`, so the website address is `https://rpheidrick.github.io/pedal-sim/`.

## Publish a finished phase

1. In `pedal-sim-public`, on the phase branch: `npm test` passes and everything is committed.
2. Claude copies the finished files into `pedal-sim-site` (or copy them yourself: everything except the `.git` and `node_modules` folders; delete files there that no longer exist in the phase).
3. In GitHub Desktop, switch to the **pedal-sim-site** repository (top left), write a summary (for example `Pedal Sim, phase 18`) and **Commit to main**, then **Push origin**. The public site updates about 2 minutes later.

## Go public and back to private

1. On GitHub: **pedal-sim** → **Settings → General → Danger Zone → Change visibility → Public**.
2. **Settings → Pages**: Source **Deploy from a branch**, Branch **main**, folder **/ (root)**, **Save**. After a minute or two the page shows the address.
3. Open that address on another computer (or a phone) and try it: Power on, a starter board, a knob.
4. **Back to private** later: the same Danger Zone setting. On a free account this also turns the website off. The code is "all rights reserved" (see LICENSE), so nobody has permission to reuse it; switching to an open license such as MIT later is just a matter of replacing LICENSE.
5. `pedal-sim-dev` stays private the whole time.

## Designing in Figma

The site's look lives in the Figma file [Pedal Sim](https://www.figma.com/design/m8yDmXcuvWnVI9cqtuHlep). See [design/FIGMA.md](design/FIGMA.md) for how Figma components and variables map to the code. In short:

1. Design (or tweak) in Figma. Try ideas on the **Explorations** page first.
2. Right-click the frame → **Copy link to selection**, and send it to Claude with what you want built.
3. Check the result at `localhost:8080`, commit on the phase branch, publish when the phase is done.

Colors and sizes are Figma variables that match `styles/tokens.css`; if you change one side, ask Claude to sync the other.

## Go back to an earlier state

* **Just look at an older version:** switch **Current branch** to that phase branch and run it locally. Switch back to your current branch when done. (Commit or stash your changes first; GitHub Desktop will ask.)
* **Undo a bad publish:** on `main`, open the **History** tab, right-click the merge or commit that broke it → **Revert changes in commit** → **Push origin**. This adds a new commit that undoes the change, so nothing is lost.
* **Start over from an older phase:** right-click a commit in **History** → **Create branch from commit**.

## Phase history

| Branch | What it contains |
|---|---|
| `phase/1-simulator` | Engine bench, LTspice import, first pedal library |
| `phase/2-pedalboard` | Live pedalboard with audio input and output |
| `phase/3-cpp-engine` | C++ engine compiled to WebAssembly |
| `phase/4-local-workflow` | Local dev server, launcher, page badge, this guide |
| `phase/5-design-system` | Figma design system (variables, components, screens), hardware color tokens, design/FIGMA.md |
| `phase/6-polish` | Sliders under knobs, chain zoom, foldable racks, 4× oversampling, speaker cabinet, peak limiter, Auto level, tuned demo riff |
| `phase/7-beginner-guide` | Guided tour at the visitor's pace, pedal and knob help, effect type intro, starter boards, real guitar samples, knob names explained, boards matched to electric or acoustic, simpler Output panel, quiet start with sound check and safety cap, look-ahead limiter |

| `phase/8-*` to `phase/13-save-share` | Figma looks (Workshop, Tube amp, Arcade), drag and drop, paint shop, live guitar setup and tuner, digital guitar, 16 recording slots, Pedal Workshop, Build it yourself sheets, save and share boards |
| `phase/14-backend-review` | Plain-language comments through the C++ engine, faster solver, crash guards, bug fixes, speed test |
| `phase/15-cleanup` | Folders reorganised (`circuits/`, `engine/`, `site/`), page code split into small files, browser tests, soak and damaged-input tests, faster Power on |
| `phase/16-clean-input` | Guitar noise and level check, input cleanup (hum canceller, hiss filter, noise gate), louder calibration, test clip, input remembered after reload, menus follow their button when the page scrolls |
| `phase/17-demo-ready` | Record a riff, brand names removed (circuits renamed `germanium-fuzz`, `op-amp-drive`; "USB guitar cable"), LICENSE (all rights reserved, provided as is), two repository publishing (private dev, clean public site) |

Phases 1 to 3 are restore points. Each one also has an extra "Add local dev server" commit so it can be run locally with `run-local.cmd`; their code is otherwise exactly as it was. They are never merged into `main`.

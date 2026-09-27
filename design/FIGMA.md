# Figma ↔ code

**Figma file:** [Pedal Sim](https://www.figma.com/design/m8yDmXcuvWnVI9cqtuHlep) (team: Ricky Heidrick (Richaardo)'s team, Professional plan, Full seat)

Figma is where the site's look is designed. The code is where it runs. This page says how the two stay in step.

## Pages in the Figma file

| Page | What's there |
|---|---|
| Cover | What the file is, and the workflow |
| Design System | Foundations: every color, text style, spacing and radius value |
| Components | The building blocks, grouped: Pedal parts, Pedal enclosure, Controls, Library |
| Screens | The pedalboard page at desktop (1440) and phone (390) |
| Explorations | Free space for trying ideas without touching the real screens |
| Phase 9 · Workshop | The Workshop look: style board (palette, type, buttons, surfaces), the **Pedal / Workshop** component set (Finish = Painted, Brushed, Candy, Hammertone, Matte black, Relic), the **Motion spec** (add, remove, move, stomp) and the Workshop board screen |

| Phase 10 · Tube Amp | The Tube amp look: style board (palette, script and panel type, cream and piped buttons, jewel lamp, chicken head knob, tolex, grille cloth, tube glow), the **Digital guitar deck**, **Guitar setup · 4 steps** and **My recordings · 16 slots** |

| Phase 11 · Arcade | The Arcade look: style board (neon palette, Audiowide and Press Start 2P, arcade buttons, TILT light, bumper footswitch) and the **Pedal Workshop** (describe your sound, build a pedal templates and choices) |

| Phase 12 · Build it | The **Build sheet** dialog: header, tabs (Parts, Schematic, Wiring, Drill template, Steps), parts table, downloads; and (Phase 13) the **Save this board** / **Share this board** menus and the **My board** card |

**One page per look.** Each design phase gets its own page and its own mode in the Tokens collection (**Classic (Phase 8)**, **Workshop (Phase 9)**, **Tube Amp (Phase 10)**, **Arcade (Phase 11)**), so an earlier look can always be restored. On the site the same looks are in `styles/themes.css` and the Look menu in the header (`site/looks/theme.js`).

## Tokens: Figma variables = `styles/tokens.css`

Every Figma variable in the **Tokens** collection has a code name (Figma calls it *code syntax*) that is the CSS variable it matches. In Dev Mode, inspecting any layer shows `var(--c-accent)` rather than a hex value.

| Figma variable | CSS variable |
|---|---|
| `color/surface/bg`, `panel`, `panel-2`, `panel-3` | `--c-bg`, `--c-panel`, `--c-panel-2`, `--c-panel-3` |
| `color/line/default`, `strong` | `--c-line`, `--c-line-strong` |
| `color/text/default`, `dim`, `faint` | `--c-text`, `--c-text-dim`, `--c-text-faint` |
| `color/signal/accent`, `accent-2`, `accent-3`, `grid`, `axis` | `--c-accent`, `--c-accent-2`, `--c-accent-3`, `--c-grid`, `--c-axis` |
| `color/status/ok`, `warn`, `err`, `info` | `--c-ok`, `--c-warn`, `--c-err`, `--c-info` |
| `hardware/knob`, `ink`, `led-on`, `led-off`, `cable`, `chrome-hi/-mid/-lo` | `--hw-knob`, `--hw-ink`, `--hw-led-on`, `--hw-led-off`, `--hw-cable`, `--hw-chrome-*` |
| `pedal/*` (one per library pedal) | `--pedal`, set per pedal from `color` in `circuits/index.js` |
| `spacing/1` to `spacing/6` | `--sp-1` to `--sp-6` (4, 8, 12, 16, 24, 32 px) |
| `radius/sm`, `md`, `lg` | `--radius-sm`, `--radius-md`, `--radius-lg` |
| `font-size/xs` to `xl` | `--fs-xs` to `--fs-xl` |

The Tokens collection has one **mode per look**. A mode's values are the CSS variables under `:root[data-theme="<look>"]` in `styles/themes.css` (Classic is the plain `tokens.css`). Workshop adds `--font-display` (Big Shoulders Display) and `--font-label` (Barlow Condensed); Tube amp uses Yellowtail and Oswald, plus `--piping` and `--tolex`.

**Rule:** a color or size change goes in both places. Change it in Figma, then ask Claude to "sync tokens.css with the Figma variables", or the other way round.

## Components ↔ code

| Figma component | Variants / properties | Code |
|---|---|---|
| Knob | Value = 0 / 5 / 10; Label. Includes the slider and the value readout | `site/looks/knob.js` (`createKnob`), `.knob*`, `.knob-slider` in `styles/app.css` |
| LED | State = On / Off | `.pedal-led` |
| Footswitch | | `.footswitch` |
| Jack | Label | `.jack` |
| Badge | Type = Mine / Classic | `.badge`, `.badge.mine` |
| Badge/Local preview | Branch | `.local-badge` (local server only) |
| Pedal | Knobs = 2 / 3, State = On / Bypassed; Name, Subtitle, Show subtitle, Show variant switch | `pedalEl()` in `site/board/chain.js`, `.pedal*` (width follows the knob count, `--cols`) |
| Zoom control | Zoom (text) | `.zoom` in `index.html` / `styles/app.css`, `setZoom()` and `fitZoom()` in `site/board/zoom.js` |
| Rack/Collapsed | Name | `.rack.collapsed`, `.rack-toggle`, `setRack()` in `site/layout.js` |
| Button | Style = Secondary / Primary / Toggle on; Label | `.btn`, `.add`, `.toggle` |
| Tabs, Tabs/Segment | Selected; Label | `.seg` in `index.html` |
| Meter | resize the `level` layer | `.meter`, `.meter-fill` |
| Power pill | State = Off / On | `#power`, `.power` (in the Signal chain header; glows while off) |
| Power button (round) | State = Off / On | no longer on the page (replaced by Power pill) |
| Library card | Origin = Mine / Classic; Name, Blurb | `renderLibrary()` in `site/board/library-ui.js`, `.lib-card` |
| Guide step | Step, Title, Body, Done | `site/help/tour.js`, `.tour-card`, `.tour-ring`, `.tour-done`; steps in `TOUR_STEPS` in `site/help/guide.js` |
| Sound check | | `#sound-check` in `index.html`, `.sound-check`, `site/audio/output-profiles.js`, `openSoundCheck()` in `site/audio/output-rack.js` |
| Starter board | Selected = true / false | `renderPresets()` in `site/board/starter-boards.js`, `site/board/presets.js`, `.preset` |
| Sample option | Selected = true / false | `renderSamples()` in `site/inputs/input-rack.js`, `site/inputs/samples.js`, `.sample` |
| Pedal info | | `toggleInfo()` in `site/board/info-card.js`, `.info-pop`, `.pedal-info` |
| Tooltip | Text | `site/help/tips.js`, `.tip` |
| Pedal / Workshop | Finish = Painted / Brushed / Candy / Hammertone / Matte black / Relic | `data-finish` on `.pedal`, finishes in `styles/fx.css`, Paint shop in `site/looks/paint.js` |
| Digital guitar deck | Pads, Tools, Fretboard | `site/inputs/digital-ui.js`, `site/inputs/digital.js`, `.deck`, `.pad`, `.fretboard` in `styles/play.css` |
| Guitar setup · 4 steps | Connect, Level, Tune, Play | `site/inputs/guitar-setup.js`, `site/inputs/tuner.js`, `.guitar-setup`, `.tuner` in `styles/play.css` |
| My recordings · 16 slots | | `samples/mine/recordings.js`, `tools/add-recording.js`, `add-recording.cmd` |
| Pedal Workshop | Tabs, Describe result, Templates, Choices | `site/workshop/ui.js`, `describe.js`, `templates.js`, `store.js`, `styles/workshop.css` |
| TILT, Bumper footswitch | | `.tilt`, `body.limiting`, `.footswitch` in the Arcade section of `styles/themes.css` |
| Save this board, Share this board, My board card | | `#board-save`, `#board-share`, `.mine-board` in `site/board/starter-boards.js`, `site/board/share.js`, `styles/fx.css` |
| Build sheet | Tabs, Parts table, Downloads | `site/build/ui.js`, `parts.js`, `schematic.js`, `drill.js`, `styles/build.css` |
| Motion spec | Add, Remove, Move, Stomp | `.pedal.enter`, `.pedal.leaving`, `.pedal.dragging`, `.pedal.stomp` in `styles/fx.css`; `burst()`, `flip()`, `enableDrag()` in `site/looks/fx.js` |
| Effect type | Name, Description | `renderTypes()` in `site/board/library-ui.js`, `EFFECT_TYPES` in `circuits/index.js`, `.fx-type` |

Text styles (`Display/Hero`, `Label/Panel`, `Pedal/Name` …) and effect styles (`Shadow/Panel`, `Shadow/Pedal`, `Glow/LED`) carry a description naming the CSS rule they match.

Names match on both sides on purpose: when you rename or add a component, keep the Figma name and the CSS class recognisably the same.

## The design loop

1. Work on a phase branch (for example `phase/6-visual-polish`), with `run-local.cmd` running.
2. Design in Figma. Put new ideas on **Explorations** first; when one is chosen, update **Components** / **Screens**.
3. Select the frame, **right-click → Copy link to selection**, and paste the link to Claude with what you want, for example:
   * "Implement this frame: *link*. Use our tokens; don't touch the audio code."
   * "Compare the live page with *link* and list the differences. Don't change anything yet."
   * "I changed variables in the Figma file. Update tokens.css to match and tell me what changed."
   * "Create a phaser pedal in Figma using the Pedal component: Rate, Depth, Feedback; purple."
4. Claude edits the code in your folder. Refresh `localhost:8080` and compare with the Figma frame.
5. Commit on the phase branch. When the phase is done, merge into `main` to publish.

## Known differences between Figma and the site

* Knobs in Figma show three fixed positions (0, 5, 10); the site draws any position, and the slider under each knob follows it.
* Zoom and folded racks are shown as components; the Desktop screen shows the default (100%, racks open).
* The pedal's hover tools (move left/right, remove), the live scope trace and the meters are static pictures in Figma.
* Gradients (enclosure shading, footswitch chrome, power button) use the hardware colors as fixed values; Figma can't bind gradient stops to variables.

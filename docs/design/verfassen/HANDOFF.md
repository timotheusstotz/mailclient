# Compose window and window bar (Verfassen und Leiste): design hand-off

Approved by Tim on 2026-11-23: the compose window (`dunkel-verfassen.html`) and the bar (`dunkel-leiste.html`),
including Strg+S for "Als Entwurf speichern" ("Beides passt"); then the mail window, opening a draft and the
failed save ("Alle drei passen"). Behaviour is fixed in `docs/specs/drafts-and-dock.md`; this file covers only
the look. Light variants are not drawn yet.

## What is in this folder

| File | What it is |
| :-- | :-- |
| `verfassen.css` | New tokens and every class for the window frame, the compose window and the bar. It builds on `../leseansicht/reader.css` (tokens, `.btn`, `.tip`, `.tile`, `.ic`, `.icw`, `mv-*`) and `../liste/list.css` (rail, folders, list). Port from these three files. |
| `index.html` | List of all screens. Open it over a local server so the stylesheets load. |
| `dunkel-verfassen.html` | Q1: a new message opened from a mailto link, saved once, over the dimmed app. |
| `dunkel-leiste.html` | Q2: the app with three windows in the bar, the pointer on one tab's x. |
| `dunkel-mail-fenster.html` | Q3: a mail opened by double-click in its own window, its tab expanded. |
| `dunkel-entwurf-oeffnen.html` | Q4: Google › Entwürfe, a draft in the reader with "Weiterschreiben". |
| `dunkel-fehler.html` | Q5: closing failed to save because the account is offline. |
| `tokens-und-zustaende.html` | New tokens, saved-line states, tab and button states, the minimize motion. |

The pages are static. `.is-hover`, `.is-active` and `.is-focus` exist only to draw states. Do not port them; real
hover goes behind `@media (hover: hover)`.

## App frame with the bar

- The window becomes a column: `.vf-main` (rail, folders, list, pane, as before) over `.dock`.
- The bar is **docked**: 44 px high, full window width, `--surface-2` with a `--line` edge on top. It takes its
  height from the panes; it never covers content. It exists only while at least one window is open.
- While a window is expanded, `.scrim` (`--scrim`) covers `.vf-main` only. The bar stays above it, so its tabs stay
  clickable.
- The undo toast (`.toast2`, bottom centre) moves up by the bar's height while the bar is shown
  (`bottom: 20px + 44px`).

## Tabs (`.dt`)

- 32 px high, 148 to 264 px wide, radius 8, 1 px `--line-strong`, `--surface`, 13/500 `--ink-2`. Gap 6 px, from the
  left edge of the bar at 12 px.
- Content: an icon (14 px, `--ink-3`), the title, the x.
  - Draft: pencil. Mail: envelope. The icon tells them apart, not colour.
  - Title: the subject, else "Neue Nachricht". One line, ellipsis. The full subject goes in `title`, prefixed
    "Entwurf: " or "Mail: ".
  - The x (`.dt-x`, 24 px, radius 6) is always there, so the title never moves on hover. Label: "Schließen,
    Entwurf bleibt" for drafts, "Schließen" for mails.
- Hover: `--surface-hover`, border `--line-hover`, text and icon `--ink`, icon lifts 1 px. The x goes to `--ink-2`.
- Pointer on the x: x fill `--surface-pressed`, glyph `--ink`, turns 90°; tooltip above it (`.tip--up`) with
  "Schließen, Entwurf bleibt" and the subject in a second, smaller line.
- Pressed: `scale(0.98)`, `--surface-pressed`. Focus: the usual 2 px `--focus` ring at 2 px.
- Expanded window's tab (`.is-open`): `--accent-soft`, border `--accent-line`, text `--accent-ink` at 600, plus a
  2 px accent line 7 px above the tab. At most one tab carries it. `aria-pressed="true"`.
- Many tabs: they shrink to 148 px each; what does not fit is not designed yet (see below).

## The window frame (`.cw`)

Compose windows and mail windows share this frame.

- 920 px wide, centred horizontally, 40 px from the top and from the bar. Radius 12, `--surface`,
  `--shadow-pop` plus a 1 px `--win-ring`.
- Head (`.cw-head`), 56 px, hairline below:
  - a 28 px kind tile (`.cw-kind`, pencil for compose) and the title, 15/650, one line;
  - compose: "Neue Nachricht", "Antwort an <Name>" or "Weiterleitung". The subject is **not** repeated here,
    it is in the Betreff field and on the tab;
  - the saved state (`.cw-state`, see below), a 1 px divider;
  - Minimieren: arrow into a line, sinks 2 px on hover, tooltip "In die Leiste legen (Klick daneben)";
  - Schließen: X, turns 90° on hover (`mv-quarter`), tooltip "Schließen, Entwurf bleibt (Esc)".

## Compose window

### Saved state (`.cw-state`)

12.5 px `--ink-3`, tabular, with a check icon: "Entwurf gespeichert · 14:02". It shows the time of the last
successful save (button, minimize, close or switching window). No autosave exists, so the line only changes after one
of those. Before the first save the line is absent. While a save runs longer than 300 ms: a small turning ring and
"Wird gespeichert …". After a failed save: `.is-err`, warning icon, "Nicht gespeichert" in `--danger` at 600 (see
"Failed save").

### Fields (`.cw-fields`, side padding 20 px)

Each row: a 76 px label column (13 px `--ink-3`, top aligned) and the value; min height 48 px; hairline below.

- **Von**: a chooser (`.cw-pick`), not a native select: the account colour square (8 px, `--a`), the name 14/600, the
  address in `--ink-3`, a chevron. Hover `--surface-hover` with `--line-hover`, the chevron drops 1 px. It opens a menu
  like the reader's menus (`.menu`, `.mi`), one item per account with its colour.
- **An**: recipient chips (`.rc`, 28 px pill, `--surface-3`, 13/500, a small x), then the typing area. On the right a
  small bordered button (`.btn--s`) "Kopie, Blindkopie" with a plus. A press adds the rows "Kopie" and
  "Blindkopie" under An, and the button goes.
- **Betreff**: 15/600, wraps to **at most two lines**, then scrolls inside. Enter does not break the line (it
  moves to the text). An empty subject stays empty (placeholder "Worum geht es?").

### Text (`.cw-editor`)

- On the theme surface, not on the white sheet. 15/1.6 `--ink`, at most 72 characters per line, left padding 116 px
  (12 px inside the field values, which start at 20 + 76 + 8 = 104 px), 24 px on the right.
- Quoted text (replies): `.cw-quote`, 2 px `--quote-line` on the left, `--ink-3`, a header line at 13 px.
- Caret `--caret`.

### Attachments (`.cw-att`)

- Only when there are attachments. Head line: paperclip, "2 Anhänge · 1,6 MB" (singular "1 Anhang · 412 KB"), and
  on the right "Dateien hineinziehen oder mit Strg+V einfügen".
- Tiles as in the reader (`.tile`, `.thumb`, `.tname`, `.tsize`), grid `minmax(260px, 1fr)`. The right button
  removes the file: X, wobbles on hover (`mv-shake`), `--danger-soft` and `--danger` on hover.
- Over 20 MB in total the size in the head turns `--danger` and adds "· viele Server lehnen mehr als 20 MB ab".
- While files are dragged over the window, today's drop layer stays ("Loslassen, um anzuhängen").

### Foot (`.cw-foot`), 64 px, `--surface-2`, hairline above

Left to right:

| Control | Kind | Hover move | Tooltip |
| :-- | :-- | :-- | :-- |
| Anhang | `.btn` with paperclip | lifts 2 px | |
| Vorlage ▾ | `.btn` menu trigger (replaces the native select), only when templates exist | lifts 2 px | "Textbaustein an der Schreibmarke einsetzen" |
| (space) | | | |
| Verwerfen | `.btn--plain.btn--danger`, trash, no border; red text, icon and `--danger-soft` only on hover | wobbles | "Entwurf in den Papierkorb legen und Fenster schließen" |
| divider | 1 × 24 px `--line-strong` | | |
| Als Entwurf speichern | `.btn--outline` (accent outline) | sinks 2 px | "Als Entwurf speichern (Strg+S)" |
| Später senden ▾ | `.btn` menu trigger with clock (replaces the native select) | tilts | the outbox sentence of today, with real umlauts |
| Senden | `.btn--primary`, the only filled button in the window | arrow right 3 px | "Senden (Strg+Enter)" |

- The hint line of today ("Dateien hineinziehen … · Strg+Enter sendet") goes: the drop hint moves to the attachment
  head, the keys into the tooltips.
- "Später senden" opens a menu like "Zurückstellen bis" in the reader: the presets with their resolved time on the
  right, a separator, "Zeitpunkt wählen …" (the existing time row of today).
- While sending: Senden keeps its label, shows "Wird gesendet", and all foot buttons are muted.
- **Strg+S** saves (new shortcut, approved).

## Mail window (Q3)

- Opened by double-click on a list row. The row becomes the selection as on a single click, so the pane behind
  shows the same mail.
- Same `.cw` frame. Head: an envelope kind tile, **Antworten** (primary, the only filled button), **Weiterleiten**
  (outlined with label), **In den Papierkorb** (icon in a `.seg`, neutral until hover), a flexible gap, the divider,
  Minimieren, Schließen ("Schließen (Esc)"). Tooltips and keys as in the reader (R, F, Entf).
- Body (`.cw-body`): `--paper` with 16 px padding, holding the reader's envelope unchanged (`.env`: head with subject,
  Von, An, date; attachments; the white sheet). The envelope drops its card shadow inside the window.
- Read-only: no fields, no foot. Its tab in the bar shows the envelope icon and is marked `.is-open` while expanded.
- Antworten or Weiterleiten open a compose window, which takes the expanded place; the mail window goes to the bar.

## Drafts in the list and the reader (Q4)

- In the Drafts folder a row shows the recipient where other folders show the sender: "An" in `--ink-3`
  (`.r-pre`), then the first recipient. Without recipient: "Kein Empfänger"; without subject: "Kein Betreff", both
  in `--ink-3` (`.is-none`). Drafts carry no unread dot. The date is the time of the last save.
- List head: "Entwürfe", meta "Google · 4 Entwürfe".
- Reader for a draft:
  - The action bar holds **Weiterschreiben** as the primary in place of Antworten (pencil, tilts on hover), and on the
    right only In den Papierkorb. Tooltip: "Weiterschreiben" with the line "Doppelklick auf die Zeile".
  - A notice row inside the envelope, under the head (`.note-draft`, `--surface-2`, 44 px, pencil): "Entwurf, noch
    nicht gesendet · gespeichert **heute, 14:02**" ("gestern, …", else the date).
  - Attachments and the white sheet as for any mail.
- Weiterschreiben and a double-click on the row open the compose window for that draft. If it is already open in a
  window, that window comes forward instead.

## Failed save (Q5)

Drawn for: Tim pressed X, the account (Google) is offline. The rail tile shows the offline dot as in the list design.

- The window stays open and nothing in it moves except the error row, which appears under the head.
- Head state: "Nicht gespeichert" (see Saved state).
- Error row (`.cw-err`, `role="alert"`), full width under the head: `--danger-soft`, a hairline of `--danger` at 35 %,
  a 28 px mark with the warning icon in `--danger`, then **"Der Entwurf ließ sich nicht speichern."** and in
  `--ink-2` the cause and what is safe: "Google ist offline. Dein Text bleibt in diesem Fenster, zuletzt gespeichert
  um 14:02." On the right **Erneut versuchen** (`.btn--s.btn--outline`, the icon turns).
  - Other causes keep the first sentence and change the second: "Die Anmeldung bei web.de ist fehlgeschlagen." or
    "Der Server hat nicht geantwortet." Never a raw error code.
  - A successful retry removes the row and shows "Entwurf gespeichert · <time>".
- The X is **armed** (`.is-armed`: `--danger` border and glyph, `--danger-soft`) with the tooltip "Noch einmal
  klicken schließt ohne Speichern" shown at once. A second click closes without saving. The armed state ends when Tim
  types, retries, or after 6 s.
- The same row appears after a failed save from the button, from minimize or from switching windows. Minimize and
  switching do not happen then: the window stays expanded (the spec: a failed save never hides the window).
- Verwerfen in the foot stays as it is.

## Motion

Easing `cubic-bezier(0.2, 0.8, 0.2, 1)`, colour 120 ms linear, as in the reader.

| What | Move |
| :-- | :-- |
| Minimize (the button, or a click beside the window) | The window shrinks into its tab: `transform` from the window rect to the tab rect (FLIP), 240 ms, opacity to 0 in the last 80 ms; the scrim fades out over 200 ms. The tab takes `.is-open` off at the end. |
| Restore (tab click) | The reverse from the tab, 280 ms; the scrim fades in over 200 ms. Content is already mounted, nothing re-renders. |
| Close (X, Esc, tab x) | The window fades and drops 8 px, 160 ms. Its tab leaves the bar: the tabs to its right slide over, 200 ms. |
| Bar appears or goes | Slides in from below, 200 ms; the panes shrink with it in the same frame. |
| Switch between two windows | The open one minimizes into its tab while the other grows out of its own, both at once. |

Under `prefers-reduced-motion: reduce` windows and the bar fade (120 ms) without moving or scaling.

## Narrow window (1120 px)

- The window keeps 40 px of margin on each side: width `min(920px, 100% - 80px)`.
- Foot under about 820 px window width: Anhang and Vorlage drop their labels (icon buttons with tooltip), the rest
  keeps its labels.
- Tabs keep 148 px minimum; the bar does not scroll.

## Tokens

All existing names come from `reader.css` and `list.css`. New in `verfassen.css`:

| Token | Dark | Light | Use |
| :-- | :-- | :-- | :-- |
| `--scrim` | `rgba(6, 8, 12, 0.58)` | `rgba(20, 26, 38, 0.30)` | Over the app while a window is expanded |
| `--win-ring` | `rgba(255, 255, 255, 0.06)` | `rgba(16, 22, 34, 0.08)` | 1 px edge of a floating window |
| `--caret` | `#82a6f0` | `#2f5bd0` | Text caret in the editor |
| `--quote-line` | `#3a424e` | `#cdd3db` | Line beside quoted text (= `--line-strong`) |

Light values are proposed and not yet shown to Tim.

## Copy

"Neue Nachricht", "Antwort an …", "Weiterleitung", "Entwurf gespeichert · 14:02", "Minimieren", "In die Leiste legen
(Klick daneben)", "Schließen", "Schließen, Entwurf bleibt", "Von", "An", "Kopie", "Blindkopie", "Kopie, Blindkopie",
"Betreff", "Worum geht es?", "2 Anhänge · 1,6 MB", "Dateien hineinziehen oder mit Strg+V einfügen", "Loslassen, um
anzuhängen", "Entfernen", "Anhang", "Vorlage", "Verwerfen", "Als Entwurf speichern", "Später senden", "Zeitpunkt
wählen …", "Senden", "Wird gesendet", "Offene Fenster" (the bar's label), "Entwurf: …", "Mail: …", "Weiterschreiben", "Doppelklick auf die Zeile", "Kein Empfänger", "Kein Betreff", "Entwürfe", "4 Entwürfe",
"Entwurf, noch nicht gesendet · gespeichert heute, 14:02", "Wird gespeichert …", "Nicht gespeichert", "Der Entwurf
ließ sich nicht speichern.", "Google ist offline. Dein Text bleibt in diesem Fenster, zuletzt gespeichert um 14:02.",
"Erneut versuchen", "Noch einmal klicken schließt ohne Speichern", "Antworten", "Weiterleiten", "In den
Papierkorb". Replace today's
"Schliessen", "Spaeter senden", "waehlen", "anhaengen", "einfuegen".

## Not designed

- The light theme of both screens (after the dark ones, as for the other screens).
- More tabs than fit the bar.
- The Von menu and the two menus of the foot drawn open (they follow the reader's menus).
- Saving all windows on quit (the up to 8 s wait): no visible state designed; the app quits when done.
- A draft opened in the reader while the same draft is open in a window (the window comes forward; the reader shows
  the last saved version).
- Phones.

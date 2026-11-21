# Reading view (Leseansicht): design hand-off v1

Approved by Tim on 2026-11-16 ("ja passt so"), including the three assumptions: 36 px buttons, plain-text
mails in the sans font, and a trash button that stays neutral until hover.

Scope: the reading pane only. The list, sidebar, composer and settings are drawn as context and are not part
of this design.

## What is in this folder

| File | What it is |
| :-- | :-- |
| `reader.css` | All tokens as custom properties (`.mc[data-theme="dark"]`, `.mc[data-theme="light"]`) and every component class with its states. Port from this file. |
| `index.html` | List of all screens. Open it over a local server (`python -m http.server`) so the stylesheet loads. |
| `dunkel-*.html`, `hell-*.html` | One static screen per approved artboard, dark and light. Menus are drawn open where the name says so. |
| `dunkel-schmal-*.html` | The narrow layout at a 1120 px window. **A proposal, not shown on the canvas.** It follows the rules below; show it to Tim before treating it as approved. |
| `tokens-und-zustaende.html` | Rest, hover, pressed and focus for every control in both themes, plus colours, type and motion. |

The screens are static exports of one component. The list and sidebar in them are drawn with a few helper
classes (`.rail`, `.folders`, `.list`, `.lrow`) that only exist for context. Do not port those.

## Layout

The pane holds, top to bottom: the action bar (56 px), then one scroll area with 16 px padding and a 12 px gap:

1. **Conversation strip** (only when the message has several in its thread): a card.
2. **The envelope**: one frame with radius 12 px, a 1 px `--line` border and `--shadow-card`. Its top part
   uses the theme's `--surface`: head, notices, attachments, each separated by a hairline. Directly under them,
   in the same frame, is **the white sheet** (`#ffffff` in both themes, because HTML mails are built for white).
   The sheet fills the rest of the envelope, so on wide windows it reaches the 16 px margin on both sides
   (unchanged rule).

Everything inside the envelope aligns to one inner edge at 24 px (16 px in the narrow layout).

### Zoom (Ctrl + wheel, Ctrl + / -)

The head used to sit inside the sheet and zoomed with it ("Ganze Mail vergrößern", commit f4647dd). It is now
part of the envelope. **Apply the zoom to the whole envelope content (head, notices, attachments and sheet),
not to the action bar or the conversation strip.** The rule is unchanged: the content grows inside the frame,
and sideways scrolling appears only once it no longer fits.

## Action bar

| Position | Control | Kind | Shortcut (tooltip) |
| :-- | :-- | :-- | :-- |
| left | Antworten | **primary**, the only filled button on the screen | R |
| left | Allen antworten | outlined (`.btn`), **only when there are several recipients** (To plus Cc, without the user) | A |
| left | Weiterleiten | outlined | F |
| right, group 1 | Markieren (star) / Markierung entfernen | icon in a segmented group; `aria-pressed`; filled star `#e8b33a` when on | S |
| right, group 1 | Als ungelesen markieren | icon | U |
| right, group 2 | Zurückstellen ▾ | menu trigger, icon + chevron; label "Zurückstellen" when the pane is wide (see below) | B |
| right, group 2 | Verschieben ▾ | menu trigger; label "Verschieben" when wide | none today |
| right, group 3 | Archivieren | icon; label "Archivieren" when wide | E |
| right, group 3 | In den Papierkorb | icon, **neutral at rest**, red icon and `--danger-soft` fill only on hover | Entf |

- Labels on the right side: the canvas shows them at a 2200 px window and hides them at 1440. In code, show
  them from a pane width of about 1100 px (container query on `.pane`). Below that, icon only.
- Icon-only buttons carry `aria-label` and a tooltip with the shortcut: "Markieren · S", "Zurückstellen · B",
  "Archivieren · E", "In den Papierkorb · Entf". Tooltip look: `.tip` in `reader.css` (ink background, 12 px,
  radius 6). Show it after about 500 ms, show neighbours at once while one is open. A plain `title` is fine as
  the first step.
- The two native `<select>` elements of today are replaced by the menus below. No grey text buttons anywhere.
- The existing shortcuts live in `App.tsx` (keydown switch). The tooltips must name exactly those keys.

## Menus

Both menus grow from their trigger (`transform-origin: top right`, from `translateY(-4px) scale(0.96)` and
opacity 0 to rest, 160 ms ease-out). While a menu is open its trigger shows the pressed fill and its chevron
turns 180°. Close on Esc, on a click outside and after a choice; focus goes back to the trigger. Opened by
keyboard, the first item takes focus; arrow keys move, Enter picks.

**Zurückstellen bis**: title row, then four presets with the resolved time on the right in `--ink-3`, tabular:
"In einer Stunde 18:13", "Heute Abend 18:00", "Morgen früh Di., 08:00", "Montag 23. Nov., 08:00", a separator,
and "Zeitpunkt wählen …" (opens the existing time dialog). Each preset has its own icon (clock, moon, sunrise,
calendar with arrow). Hide a preset that would lie in the past or within the next 30 minutes ("Heute Abend"
after 17:30). "Montag" means next Monday, a week ahead on a Monday.

**In Ordner verschieben**: a search field on top that has focus at once (typing filters, Enter moves to the
first match, Esc closes), then the folders **of the message's own account only**, under the account name with
its colour dot. The current folder comes first, muted, with a check and "aktuell"; it cannot be picked.
"Archiv" is second and shows "E" on the right. The list scrolls inside the menu (max-height 336 px, a soft
fade at the bottom).

## Head

- Subject: 22/650, `letter-spacing: -0.018em`, at most **two lines**, then an ellipsis. The full subject goes
  in `title`.
- A label column of 64 px (`--ink-3`, 13 px) and values beside it:
  - "Von": name 14/600 in `--ink`, address in `--ink-3`, date at the right ("Mo., 16. Nov. 2026, 17:13", tabular).
  - "An": the recipients, comma separated.
  - "Kopie an": only when there is a Cc.
- Many recipients: show the first four, then a small bordered button "und 5 weitere" that opens the full list
  in place (the row grows, nothing else moves sideways).

## Notices

Rows inside the envelope between head and attachments, in `--surface-2`, 48 px min height, icon in `--ink-3`,
text in `--ink-2` with the key fact in `--ink`. Actions are small buttons (30 px), never links.

- Snoozed: clock icon, "Zurückgestellt bis **Mo., 23. Nov., 08:00**", button "Jetzt zurückholen" (undo icon).
- Remote images blocked: image-off icon, "**3 externe Bilder** blockiert", button "Bilder laden" (outlined in
  the accent) and "Immer von deutschebahn.com" (the sender's domain). After either, the row disappears and the
  images load in the sheet.
- Both can appear together, snoozed first.

## Attachments

- Head line: paperclip, "2 Anhänge · 216 KB" (singular "1 Anhang · 251 KB"), and "Alle speichern" on the right
  from two attachments on.
- Tiles in a grid (`repeat(auto-fill, minmax(236px, 1fr))`, 8 px gap), each 56 px high: a 40 px thumb (an image
  preview, or the type label PDF / ICS / DOCX on a soft type colour), name 13/600 with an ellipsis, size 12 px,
  and a save icon button on the right. The whole tile apart from the save button opens the file.
- Many attachments: show at most two rows. When more exist, the last slot is a dashed tile "+ 3 weitere" that
  opens the rest in place (height change 240 ms).

## Conversation strip

A card over the envelope: "Unterhaltung · 3 Nachrichten", then one row per message (40 px): dot, sender
(600), snippet (ellipsis), a folder tag only when the folder is not the inbox ("Gesendet"), date. The current
message has `--accent-soft`, an accent dot, the sender in `--accent-ink` and `aria-current="true"`. A click
switches the message in place: the envelope frame stays, only its content changes (no remount, no fade of the
whole frame).

## The sheet

- HTML mails render as they come, on white, edge to edge inside the envelope.
- Plain-text mails: system sans 15 px / 1.6, `#1a1d23`, max 72 characters per line, padding 28 px 32 px,
  `white-space: pre-line`. Quoted lines (`>`) as `.quote` with a 2 px grey line on the left. This replaces the
  serif font of today.

## States

| State | What shows |
| :-- | :-- |
| Nothing selected | No action bar. A compact note centred in the pane: mail mark (44 px tile), "Keine Nachricht ausgewählt", "Wähle links eine aus oder blättere mit J K" (keys as `kbd.k`). |
| Loading | Action bar and head right away (from the list summary), the sheet shows grey skeleton lines. Show the skeleton only after 150 ms and keep it at least 300 ms. `aria-busy` on the sheet. |
| Error | Head and attachments stay. In place of the sheet, on the theme surface (not white): alert mark in `--danger-soft`, "Diese Nachricht ließ sich nicht laden.", one sentence, and "Erneut versuchen" (outlined, the reset icon turns). `role="alert"`. |
| Long subject | Two lines, then an ellipsis (see Head). |
| Many recipients, many attachments | See Head and Attachments. |

## Interaction states

Every value is in `reader.css`; `tokens-und-zustaende.html` shows them side by side.

- Hover (behind `@media (hover: hover)`): fill `--surface-hover`, border `--line-hover`, icon to `--ink`, plus
  the icon's own move. The primary goes to `--accent-hover`.
- Pressed: buttons `translateY(1px) scale(0.98)` and `--surface-pressed`; icons inside a group `scale(0.94)`;
  rows `scale(0.995)`; tiles `scale(0.99)`.
- Focus: one ring everywhere, 2 px `--focus` at 2 px offset (inside, -2 px, for rows and menu items).
- Menu trigger open: pressed fill, chevron turned.
- The `.is-hover`, `.is-active` and `.is-focus` classes exist only for the static pictures. Do not port them.

## Motion

Easing for everything: `cubic-bezier(0.2, 0.8, 0.2, 1)`. Colour changes 120 ms linear.

| Element | Move on hover | Value |
| :-- | :-- | :-- |
| Antworten, Allen antworten | arrow left | `translateX(-2px)`, 200 ms |
| Weiterleiten, Verschieben | arrow right | `translateX(3px)`, 200 ms |
| Markieren | star turns one point | `rotate(72deg)`, 280 ms |
| Ungelesen, Bilder laden | lifts | `translateY(-2px)`, 200 ms |
| Zurückstellen | clock tilts | `rotate(-20deg)`, 280 ms |
| Archivieren, Speichern, Alle speichern | sinks | `translateY(2px)`, 200 ms |
| Papierkorb | wobbles once, turns red | keyframes `mc-shake`, 460 ms |
| Erneut versuchen | turns | `rotate(180deg)`, 280 ms |
| Jetzt zurückholen | arrow left | `translateX(-2px)`, 200 ms |
| Chevron of a trigger | 1 px down on hover, 180° when open | |
| Menu item | icon 2 px right | 200 ms |
| Attachment tile | lifts, stronger border and shadow | `translateY(-1px)`, 200 ms |
| Menu open | grows from the trigger | 160 ms |

Under `prefers-reduced-motion: reduce` nothing moves; the menu fades in over 120 ms. The stylesheet does this
with a scoped 1 ms override for the pictures; in the app, write the moves inside
`@media (prefers-reduced-motion: no-preference)` instead.

## Narrow layout (window under about 1180 px, reading pane under 640 px)

Implemented in `reader.css` as `@container pane (max-width: 640px)`; `.pane` is the container.

- Action bar: Allen antworten and Weiterleiten drop their labels and become 36 px icon buttons (label stays for
  screen readers, tooltip with the shortcut). Antworten keeps its label. The extra gaps between the groups go,
  nothing shrinks. Smallest pane that fits: about 460 px (window about 1120 px with the list at 384 px).
- Scroll padding 12 px, envelope inner edge 16 px.
- Head: the date moves under the sender, aligned with the values.
- Notices: the actions move under the text, aligned with it.
- Attachments: tiles from 200 px.
- Conversation: no folder tag, sender 104 px, date never wraps.
- Menus at most the pane width minus 24 px.
- Below about 460 px pane width: not designed (see below).

## Tokens

Names follow `app.css`; new ones are marked `NEW` in `reader.css`. Changes to existing tokens that the port
should apply app-wide:

- `--ink-3` light `#79818e` → `#6a717d` (3.9:1 on white failed, now 5.0:1).
- `--ink-3` dark `#78818e` → `#8b94a1` (4.3:1 on `--surface` failed, now 5.2:1); `--ink-2` dark `#a7afbb` → `#b0b8c4`.
- Text on the accent: white in light (6.2:1), `#0d1422` in dark (7.4:1). Never white on the light blue.
- New: `--surface-hover`, `--surface-pressed`, `--line-hover`, `--accent-hover`, `--accent-pressed`,
  `--on-accent`, `--accent-line`, `--accent-ink`, `--focus`, `--danger-soft`, `--menu`, `--menu-line`,
  `--skeleton`, the three type-label pairs (`--pdf-*`, `--doc-*`, `--ics-*`), `--shadow-card`,
  `--shadow-raise`, `--shadow-cta`. The star colour `#e8b33a` is used in one place and has no token yet.
- The accent stays the app's blue (`#2f5bd0`, dark `#82a6f0`). The tangerine of Tim's design system belongs
  to the job flow; the structure, type sizes, spacing, states and motion here come from that system.

## Copy

German UI text with real umlauts: "Zurückstellen", "Anhänge", "Entwürfe", "ließ", "ausgewählt". Today the code
writes "Zurueckstellen", "Anhaenge", "ausgewaehlt"; replace them in the reading view. Copy used: "Antworten",
"Allen antworten", "Weiterleiten", "Markieren", "Markierung entfernen", "Als ungelesen markieren",
"Zurückstellen", "Zurückstellen bis", "In einer Stunde", "Heute Abend", "Morgen früh", "Montag",
"Zeitpunkt wählen …", "Verschieben", "In Ordner verschieben", "Ordner suchen", "aktuell", "Archivieren",
"In den Papierkorb", "Von", "An", "Kopie an", "und 5 weitere", "Unterhaltung · 3 Nachrichten",
"Zurückgestellt bis …", "Jetzt zurückholen", "3 externe Bilder blockiert", "Bilder laden", "Immer von <domain>",
"2 Anhänge · 216 KB", "Alle speichern", "+ 3 weitere", "Keine Nachricht ausgewählt", "Diese Nachricht ließ sich
nicht laden.", "Erneut versuchen".

## Not designed

- A pane narrower than about 460 px, and phones.
- Several messages selected at once (what the pane shows then).
- Preview of an image attachment, and the calendar view of an `.ics` invite.
- The time dialog behind "Zeitpunkt wählen …" (existing dialog stays as it is).
- Context menus, drag and drop of a message onto a folder, print.
- Signed or encrypted mails (S/MIME, PGP) and their marks.
- What "Als ungelesen markieren" shows afterwards (today the selection is cleared and the pane goes empty).
- The list, sidebar, composer and settings.

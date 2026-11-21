# List side (Liste und Seitenleiste): design hand-off v1

Tim approved this on 2026-11-16 ("ja passt so mach"). That covers every artboard and the five choices listed
under "Decisions Tim approved".

Scope: the account rail, the folder column, the message list with search and sync status, the splitter
between list and reading pane, and what the reading pane shows while several mails are selected. The reading
view itself is approved separately (`../leseansicht/HANDOFF.md`). It is drawn here unchanged as context.

## v2 (2026-11-19): account mark and drag and drop

Tim said the 3 px account stripe reads almost like an unread marker. He picked **B, a small colour square**,
from three variants (`v2-kontomarke-vergleich.html`). For drag and drop he wanted no further picture ("setz es
einfach um"). Build it as drawn in the `v2-*-ziehen*.html` and `v2-*-abgelegt.html` screens; he judges the
built result. The v1 screens in this folder still show the stripe, and v2 replaces it.

### Account mark (replaces decision 4's stripe)

- A 6 × 6 px square, radius 2, in `--a`, sits right before the date with a 6 px gap (`.r-date--m`, `.r-ad`).
  Remove `.r-acct`.
- It appears in the same places as the stripe did: only in views that mix accounts, never in a single folder.
  It carries the account name in `title` and in the row's accessible name.
- The unread dot on the left stays the only mark for "unread", unchanged.

### Drag and drop

Drag already exists (`src/renderer/src/lib/mailDrag.ts`: `canDrop`, `dropMail`, a text ghost). Tim asked for it
anyway, so first find out why he did not see it (not in his build, broken, or not visible). Then:

- **What is dragged:** the selection when the pressed row belongs to it. Otherwise only that row, and the
  selection stays as it is.
- **While dragging:**
  - the lifted rows fade to 45 % (`.r.is-lifted`);
  - every folder that cannot take the mails dims to 38 % (`.is-dim`): the unified views, the mails' own folder,
    Entwürfe, every folder of another account, and the group heads of other accounts;
  - folders that can take the mails stay at rest until the pointer is over them.
- **The ghost** (`.ghost`) is a 260 px card that follows the pointer at +18 / +12 px.
  - It shows the subject over the sender, or "2 Mails · Google" for several.
  - Several mails get a second card behind it and an accent count badge.
  - Over an invalid target it turns grey and carries a short dark note (`.gnote`): "Nur in Ordner von Google",
    or "Mails aus zwei Konten lassen sich nicht zusammen verschieben" for a selection from two accounts.
  - Because the ghost changes during the drag, it must be an element that follows the pointer.
    `setDragImage` is fixed at drag start; hide the native image with an empty one.
- **Valid target under the pointer:** `.fi.is-drop` (accent-soft, inset accent line).
- **Invalid target under the pointer:** a dashed outline (`.fi.is-nodrop`), the no-entry cursor and the grey
  ghost with its note.
- **A closed group or "Eigene Ordner" under the pointer:** after 600 ms of dwelling it opens. While waiting,
  `.fi.is-spring` shows a hover fill, the chevron at 45° and an accent line that fills along the bottom over
  the 600 ms.
  - It opens in place: the row stays, and its folders appear below it one level deeper.
  - Nothing at or above the pointer moves, and the height does not animate.
  - A group opened this way closes again when the drag ends without a drop inside it.
- **After the drop:**
  - the rows leave the list and the next mail is selected, as after Verschieben;
  - a toast appears bottom centre (`.toast2`): a tick, "2 Mails nach Amazon verschoben" and a real button
    "Rückgängig", which moves the mails back to their old folder. That is new behaviour; today the move toast
    has no action.
  - The toast stays 6 s, longer while hovered or focused. There is no Strg+Z hint, because that key is text
    undo in the Edit menu.
  - Dropping on a folder that already holds every dragged mail does nothing and shows no toast (as today).
- **Esc** during the drag cancels it.
- Tim may still veto the button toast. It changes the look of every toast in the app (today the action is
  underlined text).

Not designed: dropping on rail tiles, dragging at 1120 (no folder column), auto-scroll of a long folder column
while dragging.

## What is in this folder

| File | What it is |
| :-- | :-- |
| `list.css` | New tokens (light and dark) and every class for rail, folders, list, search, splitter and selection pane, with their states. It builds on `../leseansicht/reader.css` (tokens, `.btn`, `.seg`, `.menu`, `.mi`, `.ic`, `.statenote`, `kbd.k`). Port from these two files. |
| `index.html` | List of all screens. Open it over a local server so the stylesheets load. |
| `dunkel-*.html`, `hell-*.html` | One static screen per approved artboard. |
| `tokens-und-zustaende.html` | Rest, hover, pressed, focus and the other states of every control, in both themes, plus the new colours. |

The pages are static renders of one component. `.is-hover`, `.is-active`, `.is-focus` and `.is-drag` exist
only to draw states in pictures. Do not port them. Real hover goes behind `@media (hover: hover)`.

## Tokens

All existing names come from `reader.css`, which already carries the corrected `--ink-2` and `--ink-3`.
`list.css` adds only new names. None of them repeats a name from `reader.css` or `app.css` with another
meaning.

| Token | Light | Dark | Use |
| :-- | :-- | :-- | :-- |
| `--acct-google`, `--acct-google-soft` | `#2a5fcf`, `#e3ebfb` | `#77a2f5`, `#1f2a40` | Account colour as a mark or text, and its tint |
| `--acct-icloud`, `--acct-icloud-soft` | `#b35a0e`, `#fbe9d9` | `#ec9d5f`, `#36281d` | |
| `--acct-webde`, `--acct-webde-soft` | `#217648`, `#ddf0e5` | `#66c492`, `#1a3227` | |
| `--hl` | `#fcefb0` | `#4d4216` | Search hit behind the matched text |
| `--row-hover` | `#eef1f5` | `#1d2129` | Hover fill of a list row on `--paper` |
| `--star` | `#e8b33a` | `#e8b33a` | Name for the star colour the reader already uses as a literal |

**Account colours in code.** Accounts carry a colour the user picks (`account.color`). The three pairs above
are the look for Tim's three default colours. Do not hard-code them. Derive both values per account and set
them as `--a` and `--a-soft` on the element (rail tile, folder group, row, stack card):
- `--a`: in dark, `color-mix(in srgb, <color> 70%, white)`; in light, `color-mix(in srgb, <color> 80%, black)`.
  Initials on `--a-soft` must reach 4.5:1; check it for a user colour and fall back to `--ink` if it fails.
- `--a-soft`: `color-mix(in srgb, <color> 18%, var(--surface-2))`.
The classes `.acct--google` and the others in `list.css` exist only for the pictures.

## Layout

| Width | Rail | Folders | List | Pane |
| :-- | :-- | :-- | :-- | :-- |
| 1440 | 60 | 224 | 384 | rest (772) |
| 2200 | 60 | 248 | 440 | rest |
| 1120 (narrow) | 60 | hidden | 384 | rest (676) |

- Rule for the narrow layout: hide the folder column once the window is under about 1200 px. The reading pane
  then stays above 640 px and keeps its normal layout.
- The rail and the folder column use `--surface-2` with a `--line` edge on the right. The list uses `--paper`.
- The heads of the folder column (`.fd-head`) and the list (`.ls-head`) are 56 px with a hairline below.
  They line up with the reader's action bar, so one line runs across the window.
- The list width stays user-adjustable through the splitter (existing behaviour, see Splitter).

## Account rail (`.rl`)

Top to bottom:
- **Neue Nachricht** (`.rl-compose`): 40 × 40, radius 10, **outlined in the accent** (`--accent-line` border,
  `--accent-ink` pencil). It is not filled, because Antworten stays the only filled button on screen. Hover
  `--accent-soft`, pencil tilts.
- a separator.
- **Alle Konten** (layers icon) and **one tile per account**: 40 × 40, radius 10. An account tile shows its
  initials on a 28 px square in `--a-soft` with the text in `--a`.
- **Konto hinzufügen**: dashed border, the plus turns 90° on hover.
- the rest of the rail is empty; **Einstellungen** sits at the bottom, the gear turns 60° on hover.

States of a tile:
- Active (the view in front): `--surface-3` fill plus a 3 × 20 px bar in `--ink` at the rail's left edge.
  `aria-pressed="true"`.
- Unread badge: top right, 18 px pill in `--accent` with `--on-accent` text, a 2 px cut-out ring in the rail
  colour. "99+" from 100 on.
- Status dot, bottom right, 14 px:
  - connecting: a turning ring;
  - offline: a grey dot with a dash, initials dimmed to 55 %;
  - error: a red dot with "!", initials dimmed.
  The tooltip names the account, its address and the status ("web.de · … · Anmeldung fehlgeschlagen").
- Hover `--surface-hover`, pressed `scale(0.94)` with `--surface-pressed`, focus ring 2 px at 2 px offset.

## Folder column (`.fd`)

- **Head:** "Alle Konten" over "3 Konten verbunden", or the account name over its address.
- **Unified views** (only under "Alle Konten"): Posteingang, Ungelesen, Markiert, Zurückgestellt, Anhänge.
- **One group per account** (`.fg-head`): chevron, the account's colour dot, its name. A closed group shows the
  account's unread count. A group whose account has an error shows "Fehler" in `--danger`. Groups open and
  close on click, and the app remembers the state per account.
- **Default state under "Alle Konten":**
  - each group shows its standard folders (Posteingang, Archiv, Gesendet, Entwürfe, Spam, Papierkorb);
  - its own folders fold into one row "Eigene Ordner" with the count;
  - at 1440 the third account's group starts closed; at 2200 all start open.
- **One account in front:** the whole tree. Standard folders come first, then a hairline, then the account's
  own folders in server order.
- **Folder rows** (`.fi`): 30 px, icon 16 px, 13.5 px label.
  - Nesting: 16 px indent per level, at most 3 levels (deeper ones show at level 3). A parent has a chevron in
    the indent column, the same column as the group chevrons.
  - Counts: unread in `--ink-2` at weight 600, with the label in `--ink` at weight 600. Entwürfe shows its
    total in `--ink-3` at weight 400.
  - Counts are deliberately not in the accent, so a long list stays calm.
- **States:**
  - current folder: `--selected` fill, `--ink` text, `aria-current="page"`;
  - hover: `--surface-hover`;
  - pressed: `scale(0.99)`;
  - focus: ring inside (-2 px);
  - a mail dragged over a folder: `--accent-soft` with an `--accent-line` inset (`.is-drop`).
- The column scrolls on its own when the tree is longer than the window.

## Message list (`.ls`)

### Head (56 px): search field and refresh

- **Search field** (`.sf`): 36 px, `--surface`, `--line-strong` border, radius 8. A magnifier icon, the
  placeholder "Durchsuchen" and the key hint "Strg F" (the existing menu shortcut).
  - Hover: border `--line-hover`.
  - Focus: border `--focus` plus a 3 px `--accent-soft` ring.
  - With text: a clear button (×, 26 px, shakes once on hover). Esc clears.
- **Shortcut help** (`.sh`): when the field takes focus while empty, a menu grows from the field. It uses the
  reader's menu look and its 160 ms grow from the top left. It holds nine items: `von:name`, `an:name`,
  `betreff:wort`, `datei:name`, `hat:anhang`, `ist:ungelesen`, `ist:markiert`, `vor:31.01.2026`,
  `nach:31.12.2025`, each with a short German explanation. The foot reads "Sucht in allen Konten, auch auf
  dem Server". A click or Enter inserts the shortcut and focus stays in the field. Arrow keys move through
  the items. The menu closes on Esc, on the first typed character that is not a shortcut, and on blur.
- **Recognised shortcuts in the field** show as marks (`.tok`: `--surface-3` behind the text, the key in
  `--ink-3`, the value in weight 600). They are plain text with a highlight, not removable chips. Build them
  with a mirror layer behind a transparent input, so the caret and selection stay native.
- **Refresh** (`.rf`): a 36 px icon button. On hover the arrow turns 180°. While a fetch runs it turns
  continuously. **It no longer grows a label.** The status moved to the sub head, so nothing beside it moves.

### Sub head (40 px)

- Left: the title of what is shown (14/650) and a quiet meta line (12.5, `--ink-3`, tabular):

| Situation | Title | Meta |
| :-- | :-- | :-- |
| A folder or unified view | "Posteingang" | "Alle Konten · 3 ungelesen", "Google · 3 ungelesen", "web.de" |
| Search | "7 Treffer" | "in allen Konten und Ordnern" |
| Search without hits | "Keine Treffer" | "in allen Konten und Ordnern" |
| Several selected | "3 ausgewählt" | "von 16 im Posteingang", plus a small button "Alle auswählen" on the right |

- Right: the sync status, `role="status"`:
  - "Aktuell" with a tick, shown after a fetch has finished; it fades out after a few seconds, as today;
  - "Wird abgerufen …" with a turning arc;
  - an error in `--danger`, for example "web.de offline" or "web.de: Anmeldung fehlgeschlagen", with a small
    button "Erneut" (the icon turns on hover). An error stays until it is solved or the user retries.
- In the narrow layout the title becomes a menu trigger (see Narrow window).

### Rows (`.r`)

- **Comfortable** (default), about 74 px, three lines: sender and date; subject and marks; snippet.
  Padding `10px 14px 11px 30px`, a `--line` hairline between rows.
- **Compact**, about 52 px: the same without the snippet.
- **The 30 px gutter on the left** holds the **unread dot** (8 px, `--accent`). The dot is a real button
  (22 px target, `aria-pressed`, label "Als gelesen markieren" or "Als ungelesen markieren"). It toggles the
  state without selecting the row. On hover, a read row shows a hollow ring in `--line-hover` and an unread
  dot grows to 1.25.
- **Account stripe** (`.r-acct`): 3 px in `--a` at the left edge, inset 11 px from top and bottom. It appears
  **only in views that mix accounts** (unified views, search across accounts), never in a single folder.
- **Unread:** sender at weight 650 in `--ink`, subject at 600, date in `--accent-ink` at 600.
- **Read:** sender at weight 500 in `--ink-2`, subject in `--ink`, snippet in `--ink-3`.
- **Conversation count:** a small bordered pill after the sender ("2"), with the tooltip "Unterhaltung mit
  2 Nachrichten".
- **Marks**, right of the subject, in this order:
  - folder tag (only in search results outside the inbox, for example "Archiv");
  - snooze tag "bis Mo., 08:00" (clock icon, bordered pill);
  - "Wieder da" (in `--accent-soft` with `--accent-ink`, back arrow) for a mail that came back from snoozing;
  - the paperclip;
  - the filled star in `--star`.
- **Search hits** are highlighted with `<mark>` in `--hl`, in the sender and in the subject.
- **Selected** (the mail in the reading pane): `--accent-soft` fill, no stripe. It hides its own hairline and
  the one above it (`box-shadow: 0 -1px 0 var(--accent-soft)`).
- **Several selected** (Ctrl+click, Shift+click, Strg+A): every row shows a 16 px checkbox in place of the
  dot. Picked rows get the same `--accent-soft` fill with a filled checkbox (`--accent`, tick in
  `--on-accent`). The row holding the keyboard cursor gets the focus ring inside.
- **Hover** `--row-hover`; **pressed** `scale(0.995)` with `--surface-pressed`; **focus** ring inside.
  The hover changes the colour only; nothing in the row moves or appears.
- Sender and subject never wrap. The ellipsis is the last resort, with the full text in `title`.

### Empty list (`.ls-empty`)

A compact note centred in the list: a 44 px mark tile, a title and one sentence, and the next action as an
outlined button under it.

| Case | Mark | Title | Sentence | Button |
| :-- | :-- | :-- | :-- | :-- |
| Search without hits | magnifier on `--surface-3` | Keine Treffer | Für „von:anna hat:anhang“ gibt es nichts, auch nicht auf dem Server. | Suche leeren |
| Empty folder | the folder's icon on `--surface-3` | Keine Entwürfe (or "<Ordner> ist leer") | Angefangene Nachrichten landen hier, bis du sie abschickst. | Neue Nachricht (only for Entwürfe; other folders without a button) |
| Ungelesen with nothing left | green tick on `--ics-bg` | Alles gelesen | Neue ungelesene Nachrichten erscheinen hier von selbst. | none |

- Never show an empty note while a load is still running.
- With an empty list, the reading pane shows the reader's "Keine Nachricht ausgewählt".

## Splitter (`.sp`)

- At rest a 1 px line in `--line`, with a 9 px hit area centred on it and the `col-resize` cursor.
- **Hover:** the line turns `--line-hover` and a 5 × 32 px grip appears in the middle. It only fades in
  (120 ms) and moves nothing.
- **Dragging:** the line turns 2 px `--accent`, the grip turns accent and a bubble shows the width ("420 px").
- **Keyboard:** `role="separator"`, `aria-valuenow`, arrows ±16 px, focus ring around the grip.
- Double-click resets the width. Keep the existing limits and the saved width.

## Reading pane while several are selected (`.bk`)

- It keeps the reader's action bar, so the buttons stay in their place:
  - left: "Als gelesen markieren" (outlined, the icon lifts);
  - right: the same groups as the reader, [Markieren | Als ungelesen markieren], [Zurückstellen ▾ |
    Verschieben ▾], [Archivieren | Papierkorb].
  The menus are the reader's menus. "Verschieben" lists folders only when every selected mail is in the
  same account. Otherwise the button is muted and its tooltip says why.
- The body, centred:
  - a stack of up to three cards for the selected mails (front card: subject and sender with the account
    stripe; two cards behind it, smaller and fainter);
  - "3 Nachrichten ausgewählt" (22/650);
  - one line naming the accounts and folder ("Aus Google und web.de, alle im Posteingang");
  - the keys "Strg A alle 16" and "Esc Auswahl aufheben".
- The body repeats no action buttons, because the bar already has them.
- The existing text "Rechtsklick in der Liste bietet …" and the grey "Auswahl aufheben" link go.

## Narrow window (`dunkel-schmal*.html`, `hell-schmal.html`)

- There is no folder column. The sub head's title becomes a trigger, `.vt`: inbox icon, the name of the
  view and a chevron.
- It opens the folder tree as a menu (`.menu--folders`, 300 px, grows from the top left, scrolls inside with
  the fade at the bottom).
- The menu holds the same rows and groups as the column. The account groups are closed except the one in
  front.
- A pick closes the menu and focus returns to the trigger. Esc and a click outside close it too.

## Motion

Easing `cubic-bezier(0.2, 0.8, 0.2, 1)` for everything. Colour changes take 120 ms linear (values in
`reader.css`).

| Element | Move | Value |
| :-- | :-- | :-- |
| Neue Nachricht | pencil tilts | `rotate(-16deg) translate(-1px,-1px)`, 280 ms |
| Konto hinzufügen | plus turns | `rotate(90deg)`, 280 ms |
| Einstellungen | gear turns | `rotate(60deg)`, 280 ms |
| Rail tile, pressed | shrinks | `scale(0.94)` |
| Group chevron and folder twisty | turns open | 0 → 90°, 200 ms |
| Folder row, pressed | shrinks | `scale(0.99)` |
| Refresh, hover / busy | turns | 180°, 280 ms / continuous, 900 ms per turn, linear |
| Clear (×) in the search | wobbles once | `mc-shake`, 460 ms |
| Shortcut help, folder menu | grows from the trigger | 160 ms, as the reader's menus |
| Unread dot | grows on hover | `scale(1.25)`, 200 ms |
| Row, pressed | barely shrinks | `scale(0.995)` |
| Splitter grip | fades in | 120 ms |

- Under `prefers-reduced-motion: reduce` nothing moves or grows, and the menus fade in over 120 ms.
- Spinners (rail status, refresh while busy, sync arc) keep turning, slower, because they carry meaning.
- In the app, write the moves inside `@media (prefers-reduced-motion: no-preference)`.
- A group opens and closes without animating its height (it is used often).
- Rows that arrive or leave do not animate either.

## Keyboard

Keep the existing keys from `App.tsx`. The design adds only what is listed as new.

| Key | Does |
| :-- | :-- |
| J / K, ↓ / ↑ | next / previous mail |
| Strg+A | select all (existing) |
| Shift+click, Strg+click | extend selection, toggle one (existing) |
| Esc | with several selected: back to one (existing); in the search: clear, then leave the field |
| Strg+F | focus the search (existing menu shortcut), opens the shortcut help |
| Strg+R | fetch now |
| Strg+N | new message |
| ← / → on the splitter | width ±16 px (new) |
| ↑ / ↓ / Enter in the shortcut help or folder menu | move / pick (new) |
| Space or Enter on the unread dot | toggle read (new: today it is mouse only) |

## Copy

All text is German with real umlauts: "Zurückgestellt", "Anhänge", "Entwürfe", "Einstellungen", "Konto
hinzufügen", "ausgewählt". The code today writes "Zurueckgestellt", "Anhaenge", "Konto hinzufuegen",
"Suchkuerzel"; replace them.

Copy used: "Neue Nachricht", "Alle Konten", "3 Konten verbunden", "Konto hinzufügen", "Einstellungen",
"Posteingang", "Ungelesen", "Markiert", "Zurückgestellt", "Anhänge", "Archiv", "Gesendet", "Entwürfe",
"Spam", "Papierkorb", "Eigene Ordner", "Fehler", "Durchsuchen", "Strg F", "Suchkürzel · tippen oder
anklicken", "Sucht in allen Konten, auch auf dem Server", "Suche leeren", "Jetzt abrufen", "Aktuell",
"Wird abgerufen …", "web.de offline", "Erneut", "7 Treffer", "in allen Konten und Ordnern", "Keine Treffer",
"3 ausgewählt", "von 16 im Posteingang", "Alle auswählen", "Als gelesen markieren", "Als ungelesen
markieren", "Unterhaltung mit 2 Nachrichten", "bis Mo., 08:00", "Wieder da", "Keine Entwürfe", "Alles
gelesen", "3 Nachrichten ausgewählt", "Auswahl aufheben".

## Decisions Tim approved

1. Neue Nachricht in the rail is outlined in the accent, not filled.
2. A 40 px sub head under the search: what is shown on the left, the sync status on the right. The refresh
   button no longer grows a label.
3. Under "Alle Konten" each account's own folders fold into "Eigene Ordner", and the third group starts
   closed at 1440.
4. In views that mix accounts, rows carry an account mark; the selection is a soft blue fill. The mark was a
   3 px stripe in v1; since v2 (2026-11-19) it is a 6 px square before the date (see "v2" above).
5. Narrow window: no folder column, the view title above the list opens the folder tree as a menu.

## Examples, not data

- The nested folders "Depot › 2025 › Steuer" are invented to show three levels.
- The web.de and iCloud addresses are placeholders.
- The Instaffo body text is made up from its snippet.

## Not designed

- Phones and windows below about 1000 px.
- Loading the list for the first time (a skeleton of rows), and loading more rows at the end.
- Context menus on rows, folders and accounts (existing ones stay as they are).
- Dragging a mail: only the drop target on a folder is drawn (`.is-drop`), not the dragged ghost.
- Renaming, creating or deleting folders; the account wizard; settings.
- Hiding folders from the tree, and their order.
- Threads opened inside the list.
- What happens to the list after "Als ungelesen markieren" in the reader (see the reader hand-off).

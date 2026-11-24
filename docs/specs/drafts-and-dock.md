# Drafts and the window bar

Status: spec, 2026-11-23. Started from Tim's voice note: a prefilled compose window (mailto link, reply)
is lost when he clicks away; he wants "Als Entwurf speichern", and a small bar at the bottom that
collects open compose windows and opened mails, restored with a click.

## Tim's decisions (kickoff, 2026-11-23)

| Question | Answer |
| :-- | :-- |
| When is a draft saved? | Only on the button and when the window is left. No autosave while typing. |
| Click beside the compose window | Minimizes it into the bar. X and Esc close it and keep the draft. A "Verwerfen" control deletes it. An unchanged window leaves no draft. |
| What goes into the bar | Minimized compose windows and mails opened in their own window. Several at once. |
| Restore from the bar | Single click. A small x on the tab closes it (the draft stays). |

"Leaving" the window means: minimize, close (X, Esc), switching to another window, and quitting the app.
Each of these saves when the window has unsaved changes (Tim's complaint was losing mail on click-away,
and click-away is now minimize).

## Behaviour

### Saving
- A draft lives on the server in the account's Drafts folder (role `drafts`), flags `\Draft \Seen`.
  If the account has no Drafts folder, it is created as `Drafts` (`ensureFolder`).
- Each save appends the new version first, then expunges the previous one. Old versions never go to
  the trash. Saves of one window run one after another, never in parallel.
- Changing "Von" on a saved draft moves it: the new version goes to the new account, the old copy is
  expunged from the old account.
- The draft keeps To, Cc, Bcc, subject (empty stays empty, no "(kein Betreff)"), HTML body,
  attachments, In-Reply-To and References.
- "Unchanged" means: nothing differs from the state the window was opened with (or last saved with).
  An unchanged reply or forward leaves no draft. A window prefilled from outside (mailto) counts as
  changed from the start: it holds content Tim did not have anywhere else.
- A failed save never closes or hides the window. It stays open with the error, Tim decides (retry,
  Verwerfen, or close anyway with a second click).
- After a successful send (including the undo period and scheduled sending, where the outbox holds the
  message) the server draft is expunged.
- Quitting the app (tray "Beenden", window close when not in tray mode, update restart) first saves all
  windows with unsaved changes, at most 8 s, then quits.

### Discarding
- "Verwerfen" closes the window. A draft that already exists on the server moves to the trash
  (it was Tim's text, it can come back from there).

### Opening a draft
- In the Drafts folder, a draft opens into a compose window (how it is offered is a design question:
  a "Weiterschreiben" action in the reading view and/or double-click). The window then edits that draft;
  saving replaces it.
- The same draft opened twice brings the existing window forward.

### Windows and the bar
- Several windows may be open: compose windows and mail windows. At most one is expanded; the others sit
  in the bar. Expanding one minimizes the expanded one.
- Double-click on a list row opens that mail in its own mail window (read-only view with reply, forward,
  delete like the reading view). Click beside it minimizes it, X closes it.
- The bar shows one tab per open window (expanded one marked), title = subject, or "Neue Nachricht".
  Single click on a tab expands it; click on the expanded tab minimizes it; the x closes it (with the
  save rule above). The bar is absent when no window is open.
- Keyboard shortcuts of the main view work while windows sit only in the bar; they are off while one is
  expanded.
- Minimized compose windows stay mounted (hidden), so text, caret and attachments survive.

## Contract (shared/types.ts, preload)

```ts
/** Where a saved draft lives on the server. */
export interface DraftRef {
  accountId: AccountId
  folder: string        // path of the Drafts folder
  uid?: number          // from APPENDUID when the server returns it
  messageId: string     // fallback lookup when uid is missing
}

/** A draft read back from the server, ready for the composer. */
export interface LoadedDraft {
  ref: DraftRef
  message: OutgoingMessage   // subject may be empty
}

window.api.drafts.save(msg: OutgoingMessage, previous?: DraftRef): Promise<DraftRef>
window.api.drafts.open(accountId: AccountId, folder: string, uid: number): Promise<LoadedDraft>
window.api.drafts.discard(ref: DraftRef): Promise<void>   // to trash
window.api.drafts.drop(ref: DraftRef): Promise<void>      // expunge, after send

// main -> renderer before quitting; renderer saves dirty windows and answers 'app:quit-ready'
event 'app:before-quit'
```

`ComposeSeed` gains `draftRef?: DraftRef` (the window edits that server draft) and keeps
`draft?: OutgoingMessage` as the content source (already used by the outbox recall).

## Tests (tests/e2e.mjs, GreenMail)
1. Write a new mail, press "Als Entwurf speichern": exactly one message in Drafts with `\Draft`.
   Change the text, save again: still exactly one, with the new text; nothing new in the trash.
2. Click beside a changed compose window: it is in the bar, the draft is on the server. Click the tab:
   the text is still there.
3. Esc on an unchanged reply: no draft.
4. Open a draft from Entwürfe, change it, send: the mail arrives, Drafts is empty.
5. Verwerfen on a saved draft: Drafts empty, the draft is in the trash.
6. Change "Von" on a saved draft: it is in the new account's Drafts and gone from the old one.
7. Double-click a list row: a mail window opens; click beside: tab in the bar; click tab: back.

## Slices
1. Backend + composer behaviour (save, close rules, open from Drafts, drop after send, quit flush), plain
   skin, tests 1, 3-6.
2. Window state and the bar for compose windows, test 2.
3. Mail windows on double-click, test 7.
4. Port the approved look (design session "verfassen").

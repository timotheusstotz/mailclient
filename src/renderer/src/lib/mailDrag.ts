import { useSyncExternalStore } from 'react'
import type { Folder, MessageSummary } from '@shared/types'

/*
  Mails per Ziehen in einen Ordner verschieben.

  Was gezogen wird und worueber der Zeiger gerade steht, liegt in diesem
  kleinen Store und nicht im DataTransfer: der verraet waehrend des Ziehens nur
  seine Typen, nicht den Inhalt - ein Ordner muss aber schon beim
  Darueberfahren wissen, ob er die Mails annimmt, und Zeilen, Ordner und der
  Ziehgeist zeichnen sich danach. Der eigene Typ im DataTransfer sorgt nur
  dafuer, dass Dateien oder Text von aussen keinen Ordner aufleuchten lassen.
*/

const TYPE = 'application/x-mailclient-messages'

export interface DragSession {
  items: MessageSummary[]
  /** Kennungen der gezogenen Mails, fuer die angehobenen Zeilen */
  ids: Set<string>
  /** Konten, aus denen die Mails kommen; mehr als eins laesst sich nirgends ablegen */
  accountIds: Set<string>
}

export interface MailDrag {
  session: DragSession
  items: MessageSummary[]
  /** Kennungen der gezogenen Mails, fuer die angehobenen Zeilen */
  ids: Set<string>
  /** Konten, aus denen die Mails kommen; mehr als eins laesst sich nirgends ablegen */
  accountIds: Set<string>
  /** Wo der Zeiger steht, fuer den mitlaufenden Ziehgeist */
  x: number
  y: number
  /** Ueber einem Ziel, das nichts annimmt: der Geist wird grau und nennt den Grund */
  refused: { note?: string; owner: object } | null
  /** Waehrend des Ziehens aufgeklappte Gruppen: Schluessel und Konto, zum Wiederzuklappen */
  sprung: { key: string; accountId: string; close: () => void }[]
}

let state: MailDrag | null = null
const listeners = new Set<() => void>()

function set(next: MailDrag | null): void {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Der ganze Zustand mit Zeigerposition; aendert sich bei jeder Mausbewegung. Nur fuer den Geist. */
export function useMailDragPointer(): MailDrag | null {
  return useSyncExternalStore(subscribe, () => state)
}

/**
 * Was gezogen wird, ohne die Zeigerposition: bleibt waehrend eines Ziehens
 * dasselbe Objekt, so zeichnen sich Zeilen und Ordner nur am Anfang und am Ende
 * neu und nicht bei jeder Mausbewegung.
 */
export function useMailDrag(): DragSession | null {
  return useSyncExternalStore(subscribe, () => state?.session ?? null)
}

/** Ein leeres Bild statt des Abbilds der Zeile: der eigene Geist folgt dem Zeiger. */
let blank: HTMLImageElement | null = null
function blankImage(): HTMLImageElement {
  if (!blank) {
    blank = new Image()
    blank.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  }
  return blank
}

let frame = 0
function track(event: DragEvent): void {
  if (!state || (event.clientX === 0 && event.clientY === 0)) return
  const { clientX, clientY } = event
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    if (state) set({ ...state, x: clientX, y: clientY })
  })
}

export function startMailDrag(event: React.DragEvent, items: MessageSummary[]): void {
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(TYPE, String(items.length))
  event.dataTransfer.setDragImage(blankImage(), 0, 0)
  document.addEventListener('dragover', track, true)
  const session: DragSession = {
    items,
    ids: new Set(items.map((m) => m.id)),
    accountIds: new Set(items.map((m) => m.accountId))
  }
  set({
    session,
    ...session,
    x: event.clientX,
    y: event.clientY,
    refused: null,
    sprung: []
  })
}

/**
 * Ende des Ziehens, abgelegt oder abgebrochen (Esc, Loslassen ausserhalb).
 * Unterwegs aufgeklappte Gruppen gehen wieder zu - ausser denen des Kontos,
 * in dessen Ordner abgelegt wurde.
 */
export function endMailDrag(droppedInAccount?: string): void {
  document.removeEventListener('dragover', track, true)
  cancelAnimationFrame(frame)
  const current = state
  if (!current) return
  set(null)
  for (const group of current.sprung) {
    if (group.accountId !== droppedInAccount) group.close()
  }
}

/** Die gezogenen Mails, falls gerade Mails dieser App gezogen werden. */
export function draggedMail(event: React.DragEvent): MessageSummary[] | null {
  return state && event.dataTransfer.types.includes(TYPE) ? state.items : null
}

/**
 * Ein Ziel lehnt ab. `owner` ist das Ziel selbst: beim Wechsel von einem Ordner
 * zum naechsten meldet der neue sein Betreten, bevor der alte sein Verlassen
 * meldet - der alte darf dann nur seine eigene Ablehnung wegnehmen.
 */
export function refuseDrop(owner: object, note?: string): void {
  if (state && (state.refused?.owner !== owner || state.refused.note !== note)) set({ ...state, refused: { note, owner } })
}

export function clearRefusal(owner: object): void {
  if (state?.refused?.owner === owner) set({ ...state, refused: null })
}

/** Merkt sich eine beim Ziehen aufgeklappte Gruppe, damit sie danach wieder zugeht. */
export function noteSprung(key: string, accountId: string, close: () => void): void {
  if (state && !state.sprung.some((g) => g.key === key)) set({ ...state, sprung: [...state.sprung, { key, accountId, close }] })
}

/**
 * Nimmt der Ordner die Mails an? Verschoben wird nur innerhalb eines Kontos,
 * nicht in Entwuerfe, nicht in Gmails reine Sichten, und nicht dorthin, wo
 * schon alle liegen.
 */
export function canDrop(items: MessageSummary[], accountId: string, folder: Folder): boolean {
  if (!items.length || !folder.selectable || folder.hidden || folder.role === 'drafts') return false
  if (items.some((m) => m.accountId !== accountId)) return false
  return items.some((m) => m.folder !== folder.path)
}

/** Warum ein Ordner nichts annimmt, als kurzer Satz am Geist - nur wo es nicht offensichtlich ist. */
export function refusalNote(drag: DragSession, accountId: string, accountLabel: (id: string) => string): string | undefined {
  if (drag.accountIds.size > 1) return 'Mails aus zwei Konten lassen sich nicht zusammen verschieben'
  const [own] = drag.accountIds
  if (own && own !== accountId) return `Nur in Ordner von ${accountLabel(own)}`
  return undefined
}

/** Der Zustand ausserhalb von React, fuer Ereignisse, die ihn sofort brauchen. */
export function mailDragState(): MailDrag | null {
  return state
}

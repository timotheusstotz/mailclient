import { useEffect, useLayoutEffect, useReducer, useRef, useSyncExternalStore, type RefObject } from 'react'
import type { ThreadRow } from '@shared/threads'
import { EASE, reduced } from './motion'

/*
  Die kleinen Bewegungen der Liste (docs/design/liste/HANDOFF.md, v4).

  - Zeilen, die gehen, blenden in 120 ms aus und klappen in 200 ms zu. Sie
    bleiben eingehaengt, bis die Daten sie entfernen und das Zuklappen fertig
    ist; scheitert die Aktion, kommen sie zurueck.
  - Ein Briefchen (40 x 30 px) fliegt beim Loeschen zum Papierkorb des Kontos,
    gleitet nach dem Ablegen in den Zielordner oder kehrt nach einem
    Abbruch zur Zeile zurueck. Am Ziel "schluckt" der Ordner.

  Alles ist Zierde ueber der Aktion: die Daten aendern sich sofort, und nichts
  wartet auf das Ende einer Animation. Ein unsichtbares Fenster zeichnet keine
  Bilder, dort liefe sie nie zu Ende; abgeraeumt wird per Zeitgeber.
*/

const COLLAPSE_MS = 200
const LIFT_MS = 90
/** Lang genug, dass man dem Bogen mit dem Auge folgt (Tim, 2026-11-24: "dass man das wirklich sieht"). */
const FLY_MS = 520
const GULP_MS = 200
const SINK_MS = 180
const BACK_MS = 200
const VANISH_MS = 100

const TOKEN_W = 40
const TOKEN_H = 30
/** Am Zeiger haengt das Briefchen so weit rechts unter der Spitze. */
export const TOKEN_OFFSET = { x: 12, y: 10 }
/**
 * Mindesthoehe des Kontrollpunkts ueber dem hoeheren Ende. Meist hebt ihn die
 * Flugstrecke hoeher: der Scheitel liegt etwa eine halbe Strecke ueber dem
 * Weg, das ergibt fast einen Halbkreis statt eines flachen Bogens.
 */
const ARC_LIFT = 150
/** So nah darf der Scheitel an den oberen Fensterrand. */
const ARC_TOP = 16

export interface Point {
  x: number
  y: number
}

// ------------------------------------------------------------ Zeilen, die gehen

/**
 * Wie eine Zeile geht. In den Papierkorb bekommt sie beim Zuklappen einen
 * roten Hauch; hebt dabei ein Briefchen von ihr ab (`lift`), wartet sie die
 * 90 ms des Abhebens ab, wie im Entwurf.
 */
export interface Leave {
  kind: 'trash' | 'move'
  lift: boolean
  /** Ab wann sie zuklappt */
  since: number
}

/** Kennungen der Mails, deren Zeilen gerade gehen. Alle Mails eines Aufrufs teilen sich ein Objekt. */
let leaving = new Map<string, Leave>()
const rowListeners = new Set<() => void>()

function subscribeRows(listener: () => void): () => void {
  rowListeners.add(listener)
  return () => rowListeners.delete(listener)
}

function setLeaving(next: typeof leaving): void {
  leaving = next
  for (const listener of rowListeners) listener()
}

/** Die Zeilen dieser Mails gehen. Liefert, was sie zurueckholt, falls die Aktion scheitert. */
export function leaveRows(ids: string[], kind: Leave['kind'], lift: boolean): () => void {
  const entry: Leave = { kind, lift, since: performance.now() + (lift ? LIFT_MS : 0) }
  setLeaving(new Map([...leaving, ...ids.map((id) => [id, entry] as const)]))
  return () => forgetLeaving(ids)
}

function forgetLeaving(ids: string[]): void {
  if (!ids.some((id) => leaving.has(id))) return
  const next = new Map(leaving)
  for (const id of ids) next.delete(id)
  setLeaving(next)
}

/** Geht die Zeile mit diesen Mails, und wie? Sie geht, sobald eine davon geht - Aktionen treffen die ganze Zeile. */
export function useLeaving(memberIds: string[]): Leave | null {
  return useSyncExternalStore(subscribeRows, () => {
    for (const id of memberIds) {
      const entry = leaving.get(id)
      if (entry) return entry
    }
    return null
  })
}

/**
 * Die Zeilen der Liste, dazu die eben entfernten, solange sie noch zuklappen:
 * sonst spraenge die Liste, wenn der Server schneller antwortet als 200 ms.
 * Eine solche Zeile steht vor der Zeile, die ihr vorher folgte.
 */
export function useLingeringRows(rows: ThreadRow[]): ThreadRow[] {
  const shown = useRef(rows)
  const [, wakeUp] = useReducer((n: number) => n + 1, 0)
  const now = performance.now()
  const present = new Set(rows.map((row) => row.head.id))
  const before = new Map<string, ThreadRow[]>()
  let pending: ThreadRow[] = []
  let wake = Infinity
  for (const row of shown.current) {
    if (present.has(row.head.id)) {
      if (pending.length) before.set(row.head.id, pending)
      pending = []
      continue
    }
    // Was ohne eigene Aktion verschwindet (Abruf, andere Ansicht), geht sofort.
    const since = Math.min(...row.members.map((m) => leaving.get(m.id)?.since ?? Infinity))
    const rest = since + COLLAPSE_MS - now
    if (Number.isFinite(rest) && rest > 0) {
      pending.push(row)
      wake = Math.min(wake, rest)
    }
  }
  const result = pending.length || before.size ? rows.flatMap((row) => [...(before.get(row.head.id) ?? []), row]).concat(pending) : rows
  shown.current = result

  useEffect(() => {
    if (wake === Infinity) return
    const timer = window.setTimeout(wakeUp, wake + 1)
    return () => window.clearTimeout(timer)
  })
  return result
}

/**
 * Klappt die Zeile in 200 ms zu, solange sie geht; das Ausblenden macht
 * list.css ([data-leaving], [data-lift]). Mit weniger Bewegung bleibt sie
 * stehen und blendet nur. Verschwindet sie aus der Liste, vergisst der
 * Speicher ihre Mails.
 */
export function useRowLeave(ref: RefObject<HTMLElement | null>, leave: Leave | null, memberIds: string[]): void {
  const isLeaving = leave !== null
  const lift = Boolean(leave?.lift)
  useLayoutEffect(() => {
    const el = ref.current
    if (!isLeaving || !el || reduced()) return
    const style = getComputedStyle(el)
    // Die Hoehe ist ein Wert aus dem Layout und laesst sich nur hier messen, darum WAAPI statt CSS.
    const collapse = el.animate(
      [
        { height: `${el.offsetHeight}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, borderBottomWidth: style.borderBottomWidth },
        { height: '0px', paddingTop: '0px', paddingBottom: '0px', borderBottomWidth: '0px' }
      ],
      { duration: COLLAPSE_MS, delay: lift ? LIFT_MS : 0, easing: EASE, fill: 'forwards' }
    )
    return () => collapse.cancel()
  }, [ref, isLeaving, lift])

  const key = memberIds.join('\n')
  useEffect(() => {
    if (!isLeaving) return
    const ids = key.split('\n')
    return () => forgetLeaving(ids)
  }, [isLeaving, key])
}

// ------------------------------------------------------------ Briefchen unterwegs

export interface Flight {
  id: number
  count: number
  /** Setzt die Bewegung auf das eingehaengte Briefchen. */
  run: (el: HTMLElement) => void
}

let flights: Flight[] = []
let nextFlight = 1
const flightListeners = new Set<() => void>()

function subscribeFlights(listener: () => void): () => void {
  flightListeners.add(listener)
  return () => flightListeners.delete(listener)
}

function setFlights(next: Flight[]): void {
  flights = next
  for (const listener of flightListeners) listener()
}

/** Die Briefchen, die gerade fliegen, fuer die Ebene ueber dem Fenster. */
export function useFlights(): Flight[] {
  return useSyncExternalStore(subscribeFlights, () => flights)
}

function launch(count: number, life: number, run: (el: HTMLElement) => void): void {
  const id = nextFlight++
  setFlights([...flights, { id, count, run }])
  window.setTimeout(() => setFlights(flights.filter((f) => f.id !== id)), life)
}

/** Lage des Briefchens: Mitte auf `p`, dazu Drehung und Groesse. */
function place(p: Point, rotate: number, scale: number): string {
  return `translate(${p.x - TOKEN_W / 2}px, ${p.y - TOKEN_H / 2}px) rotate(${rotate}deg) scale(${scale})`
}

/** Zum Schluss taucht es in den Ordner ab. */
function vanish(el: HTMLElement, at: Point, rotate: number, scale: number, delay: number): void {
  el.animate(
    [
      { transform: place(at, rotate, scale), opacity: 1 },
      { transform: place(at, rotate, scale * 0.6), opacity: 0 }
    ],
    { duration: VANISH_MS, delay, easing: EASE, fill: 'forwards' }
  )
}

export interface TrashFlight {
  /** Wo es abhebt: der rote Bereich der Zeile oder ihr Datum */
  from: Point
  /** Das Symbol des Papierkorbs in der Seitenleiste */
  target: HTMLElement
  count: number
}

/**
 * Loeschen: das Briefchen hebt ab (90 ms), fliegt einen flachen Bogen zum
 * Papierkorb (330 ms), kippt dabei auf -14 Grad und schrumpft auf 0,6; dann
 * schluckt der Ordner. Mit weniger Bewegung fliegt nichts. Liefert, ob es fliegt.
 */
export function flyToTrash({ from, target, count }: TrashFlight): boolean {
  if (reduced()) return false
  const to = centerOf(target)
  const lifted = { rotate: -6, scale: 1.1 }
  const landed = { rotate: -14, scale: 0.6 }
  // Scheitel einer quadratischen Kurve: (from.y + 2 c + to.y) / 4. Er soll im Fenster bleiben.
  const lift = Math.max(ARC_LIFT, Math.hypot(to.x - from.x, to.y - from.y))
  const lowestControl = (4 * ARC_TOP - from.y - to.y) / 2
  const control = { x: (from.x + to.x) / 2, y: Math.max(Math.min(from.y, to.y) - lift, lowestControl) }
  const steps = 12
  const path: Keyframe[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    // Der Bogen ist eine quadratische Bezier-Kurve; die Kurve der Zeit liegt auf dem Ganzen, nicht auf jedem Stueck.
    const p = {
      x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * to.x,
      y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * to.y
    }
    const rotate = lifted.rotate + (landed.rotate - lifted.rotate) * t
    const scale = lifted.scale + (landed.scale - lifted.scale) * t
    path.push({ transform: place(p, rotate, scale), offset: t })
  }
  const arrive = LIFT_MS + FLY_MS
  launch(count, arrive + GULP_MS, (el) => {
    el.animate([{ transform: place(from, -8, 1) }, { transform: place(from, lifted.rotate, lifted.scale) }], {
      duration: LIFT_MS,
      easing: EASE,
      fill: 'forwards'
    })
    el.animate(path, { duration: FLY_MS, delay: LIFT_MS, easing: EASE, fill: 'forwards' })
    vanish(el, to, landed.rotate, landed.scale, arrive)
  })
  window.setTimeout(() => gulp(target, 'danger'), arrive)
  return true
}

/** Abgelegt: das Briefchen gleitet in 180 ms ins Ordnersymbol und schrumpft auf 0,55; der Ordner schluckt. */
export function sinkInto(from: Point, target: HTMLElement, count: number): void {
  if (reduced()) return
  const to = centerOf(target)
  launch(count, SINK_MS + VANISH_MS, (el) => {
    el.animate([{ transform: place(from, -8, 1) }, { transform: place(to, -8, 0.55), opacity: 0.9 }], {
      duration: SINK_MS,
      easing: EASE,
      fill: 'forwards'
    })
    vanish(el, to, -8, 0.55, SINK_MS)
  })
  window.setTimeout(() => gulp(target, 'accent'), SINK_MS)
}

/** Abgebrochen: das Briefchen fliegt in 200 ms zu seiner Zeile zurueck. */
export function returnTo(from: Point, to: Point, count: number): void {
  if (reduced()) return
  launch(count, BACK_MS + VANISH_MS, (el) => {
    el.animate([{ transform: place(from, -8, 1) }, { transform: place(to, -8, 1) }], {
      duration: BACK_MS,
      easing: EASE,
      fill: 'forwards'
    })
    vanish(el, to, -8, 1, BACK_MS)
  })
}

/**
 * Der Ordner schluckt: seine Zeile bekommt kurz einen Hauch der Farbe, sein
 * Symbol waechst auf 1,25 und zurueck, 200 ms.
 */
function gulp(icon: Element, tone: 'danger' | 'accent'): void {
  const row = icon.closest<HTMLElement>('[data-folder], .lv-fg-head, [data-account-tile]')
  if (!row || !icon.isConnected) return
  const style = getComputedStyle(row)
  const soft = style.getPropertyValue(tone === 'danger' ? '--danger-soft' : '--accent-soft').trim()
  const ink = style.getPropertyValue(tone === 'danger' ? '--danger' : '--accent-ink').trim()
  row.animate([{ backgroundColor: soft }, { backgroundColor: soft, offset: 0.5 }, { backgroundColor: style.backgroundColor }], {
    duration: GULP_MS,
    easing: 'linear'
  })
  icon.animate(
    [
      { transform: 'scale(1)', color: ink },
      { transform: 'scale(1.25)', color: ink, offset: 0.45 },
      { transform: 'scale(1)', color: getComputedStyle(icon).color }
    ],
    { duration: GULP_MS, easing: EASE }
  )
}

// ------------------------------------------------------------ Wo Briefchen starten und landen

/** Die Mitte des Briefchens, wenn der Zeiger bei `pointer` steht. */
export function tokenCenterAt(pointer: Point): Point {
  return { x: pointer.x + TOKEN_OFFSET.x + TOKEN_W / 2, y: pointer.y + TOKEN_OFFSET.y + TOKEN_H / 2 }
}

function centerOf(el: Element): Point {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/**
 * Steht dieser Punkt von `el` gerade im Bild: im Fenster und in jedem
 * Vorfahren, der seinen Inhalt abschneidet (weggescrollt zaehlt nicht)?
 * Bewusst ohne Trefferprobe: ein Menue, das sich gerade schliesst, laege
 * noch darueber.
 */
function inView(el: Element, p: Point): boolean {
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return false
  const inside = (box: DOMRect | { left: number; top: number; right: number; bottom: number }): boolean =>
    p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom
  if (!inside({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight })) return false
  for (let a = el.parentElement; a; a = a.parentElement) {
    const style = getComputedStyle(a)
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      if (!inside(a.getBoundingClientRect())) return false
    }
  }
  return true
}

/**
 * Das Symbol eines Ordners in der Ordnerspalte, falls es gerade zu sehen ist.
 * Zugeklappte Gruppe, schmales Fenster ohne Spalte, weggescrollt: dann keins.
 */
export function folderIcon(accountId: string, path: string): HTMLElement | null {
  const row = document.querySelector<HTMLElement>(`[data-folder="${CSS.escape(`${accountId}|${path}`)}"]`)
  const icon = row?.querySelector<HTMLElement>('svg[data-icon]:not(.lv-tw-i)') ?? null
  return row && icon && inView(row, centerOf(icon)) ? icon : null
}

/**
 * Wohin ein geloeschtes Briefchen fliegt: zum Papierkorb, wenn er zu sehen
 * ist. Liegt er in einer zugeklappten Kontogruppe, zu deren Kopf; ist auch der
 * nicht zu sehen, zur Kachel des Kontos ganz links. Tim sah sonst nie einen
 * Flug, weil in "Alle Konten" nicht jede Gruppe offen ist.
 */
export function trashTarget(accountId: string, path: string): HTMLElement | null {
  const folder = folderIcon(accountId, path)
  if (folder) return folder
  const group = document.querySelector<HTMLElement>(`[data-account-group="${CSS.escape(accountId)}"] .lv-fg-head`)
  const dot = group?.querySelector<HTMLElement>('.lv-fg-dot') ?? group
  if (group && dot && inView(group, centerOf(dot))) return dot
  const tile = document.querySelector<HTMLElement>(`[data-account-tile="${CSS.escape(accountId)}"]`)
  return tile && inView(tile, centerOf(tile)) ? tile : null
}

/**
 * Wo das Briefchen an einer Zeile abhebt: ueber ihrem roten Bereich, wenn
 * dort geklickt wurde, sonst (Entf, Menue, Leiste) ueber dem Datum. Nur wenn
 * die Zeile im Bild ist.
 */
export function rowLaunchPoint(rowId: string, spot: 'del' | 'date'): Point | null {
  const row = document.querySelector<HTMLElement>(`[data-row="${CSS.escape(rowId)}"]`)
  if (!row) return null
  const p = centerOf(row.querySelector(spot === 'del' ? '.lv-r-del' : '.lv-r-date') ?? row)
  return inView(row, p) ? p : null
}

/** Die Mitte des Briefchens, das gerade am Zeiger haengt. */
export function dragTokenCenter(): Point | null {
  const token = document.querySelector('[data-drag-token] .lv-env')
  return token ? centerOf(token) : null
}

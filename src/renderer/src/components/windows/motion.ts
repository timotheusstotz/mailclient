import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { EASE, reduced } from '../../lib/motion'

/*
  Wie ein Fenster kommt und geht (docs/design/verfassen/HANDOFF.md, "Motion"):
  Hineinlegen schrumpft es in seinen Reiter (240 ms, die letzten 80 ms blendet
  es aus), Aufklappen waechst es aus dem Reiter (280 ms), Schliessen blendet es
  aus und senkt es um 8 px (160 ms). Ohne Bewegung blenden alle nur (120 ms).

  Der Zustand haengt nie am Ende einer Animation: ein unsichtbares Fenster
  zeichnet keine Bilder, dort liefe sie nie zu Ende. Versteckt wird nach
  derselben Dauer per Zeitgeber; die Animation ist nur das, was man sieht.
*/

export const MINIMIZE_MS = 240
const RESTORE_MS = 280
export const CLOSE_MS = 160
const FADE_MS = 120

/** Wo der Reiter des Fensters in der Leiste steht. */
function tabRect(id: string): DOMRect | undefined {
  return document.querySelector(`[data-window-tab="${CSS.escape(id)}"]`)?.getBoundingClientRect()
}

/** Der Sprung vom Fenster auf seinen Reiter, als transform; ohne Reiter ein kleines Zusammenziehen. */
function towardTab(el: HTMLElement, id: string): string {
  const from = el.getBoundingClientRect()
  const to = tabRect(id)
  if (!to || !from.width || !from.height) return 'translateY(24px) scale(0.96)'
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)
  return `translate(${dx}px, ${dy}px) scale(${to.width / from.width}, ${to.height / from.height})`
}

function stop(el: HTMLElement): void {
  for (const animation of el.getAnimations()) animation.cancel()
}

function minimizeOut(el: HTMLElement, id: string): void {
  stop(el)
  if (reduced()) {
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'linear', fill: 'forwards' })
    return
  }
  const end = towardTab(el, id)
  el.animate(
    [
      { transform: 'none', opacity: 1 },
      { opacity: 1, offset: (MINIMIZE_MS - 80) / MINIMIZE_MS },
      { transform: end, opacity: 0 }
    ],
    // Haelt den Endstand, bis der Zeitgeber es versteckt; sonst blitzte es dazwischen auf.
    { duration: MINIMIZE_MS, easing: EASE, fill: 'forwards' }
  )
}

function restoreIn(el: HTMLElement, id: string): void {
  stop(el)
  if (reduced()) {
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'linear' })
    return
  }
  const start = towardTab(el, id)
  el.animate(
    [
      { transform: start, opacity: 0 },
      { opacity: 1, offset: 80 / RESTORE_MS },
      { transform: 'none', opacity: 1 }
    ],
    { duration: RESTORE_MS, easing: EASE }
  )
}

/** Ein neues Fenster: die Umkehrung des Schliessens. */
function openIn(el: HTMLElement): void {
  el.animate(
    reduced()
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { transform: 'translateY(8px)', opacity: 0 },
          { transform: 'none', opacity: 1 }
        ],
    { duration: reduced() ? FADE_MS : CLOSE_MS, easing: EASE }
  )
}

function closeOut(el: HTMLElement): void {
  stop(el)
  el.animate(
    reduced()
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { transform: 'none', opacity: 1 },
          { transform: 'translateY(8px)', opacity: 0 }
        ],
    // Bis useWindows es abbaut, bleibt es unsichtbar stehen.
    { duration: reduced() ? FADE_MS : CLOSE_MS, easing: EASE, fill: 'forwards' }
  )
}

/**
 * Bewegt das Fenster `ref` zwischen aufgeklappt, Leiste und zu. Liefert, ob
 * es versteckt sein soll; versteckt bleibt es eingehaengt, damit Text,
 * Schreibmarke und Anhaenge bleiben.
 */
export function useWindowMotion(ref: RefObject<HTMLElement | null>, id: string, expanded: boolean, leaving: boolean): boolean {
  const [hidden, setHidden] = useState(!expanded)
  const restoring = useRef(false)
  const before = useRef<{ expanded: boolean; leaving: boolean } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    const last = before.current
    before.current = { expanded, leaving }
    if (!el) return
    if (!last) {
      if (expanded) openIn(el)
      return
    }
    if (leaving) {
      if (!last.leaving && !hidden) closeOut(el)
      return
    }
    if (expanded && !last.expanded) {
      restoring.current = true
      if (hidden) setHidden(false)
      else {
        // Noch auf dem Weg in die Leiste: von dort zurueck.
        restoring.current = false
        restoreIn(el, id)
      }
      return
    }
    if (!expanded && last.expanded) {
      minimizeOut(el, id)
      const timer = window.setTimeout(() => setHidden(true), reduced() ? FADE_MS : MINIMIZE_MS)
      return () => window.clearTimeout(timer)
    }
    return
    // `hidden` ist hier nur gelesen; die Bewegung haengt am Wechsel der beiden Zustaende.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, leaving])

  // Aus der Leiste zurueck: erst jetzt hat das Fenster wieder eine Groesse.
  useLayoutEffect(() => {
    const el = ref.current
    if (hidden || !restoring.current || !el) return
    restoring.current = false
    restoreIn(el, id)
  }, [hidden, id, ref])

  return hidden
}

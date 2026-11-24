import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IconClose, IconCompose, IconMail } from '../icons'
import { EASE, reduced } from '../../lib/motion'

/** Ein Reiter in der Leiste: ein offenes Verfassen- oder Mail-Fenster. */
export interface BarTab {
  id: string
  kind: 'compose' | 'mail'
  title: string
  /** Das letzte Speichern ist gescheitert */
  failed?: boolean
}

interface Props {
  tabs: BarTab[]
  expandedId: string | null
  /** Das letzte Fenster ist zu: die Leiste faehrt noch hinaus. */
  leaving: boolean
  /** Klick auf den Reiter: aufklappen, beim aufgeklappten wieder hineinlegen */
  onToggle: (id: string) => void
  onClose: (id: string) => void
}

const SLIDE_MS = 200

/**
 * Ob die Leiste steht: sobald ein Fenster offen ist; nach dem letzten noch
 * 200 ms, waehrend sie hinausfaehrt ('leaving').
 */
export function useDockPresence(open: boolean): 'shown' | 'leaving' | null {
  const [state, setState] = useState<'shown' | 'leaving' | null>(open ? 'shown' : null)
  useEffect(() => {
    if (open) {
      setState('shown')
      return
    }
    setState((now) => (now ? 'leaving' : null))
    const timer = window.setTimeout(() => setState(null), SLIDE_MS)
    return () => window.clearTimeout(timer)
  }, [open])
  return open ? 'shown' : state
}

/**
 * Die Leiste am unteren Rand mit allen offenen Fenstern. Das Icon sagt, was
 * es ist (Stift: Entwurf, Umschlag: Mail), nicht die Farbe. Geht ein Reiter,
 * ruecken die rechts davon in 200 ms nach.
 */
export function WindowBar({ tabs, expandedId, leaving, onToggle, onClose }: Props) {
  const navRef = useRef<HTMLElement>(null)
  const lefts = useRef(new Map<string, number>())

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const still = reduced()
    const next = new Map<string, number>()
    for (const el of nav.querySelectorAll<HTMLElement>('[data-window-tab]')) {
      const id = el.dataset.windowTab!
      const left = el.getBoundingClientRect().left
      next.set(id, left)
      const was = lefts.current.get(id)
      if (!still && was !== undefined && was !== left) {
        el.animate([{ transform: `translateX(${was - left}px)` }, { transform: 'none' }], {
          duration: SLIDE_MS,
          easing: EASE
        })
      }
    }
    lefts.current = next
  }, [tabs])

  return (
    <nav className="dock" aria-label="Offene Fenster" ref={navRef} data-leaving={leaving || undefined}>
      {tabs.map((tab) => {
        const draft = tab.kind === 'compose'
        const title = tab.title || (draft ? 'Neue Nachricht' : '(kein Betreff)')
        const open = tab.id === expandedId
        const closeLabel = draft ? 'Schließen, Entwurf bleibt' : 'Schließen'
        return (
          <div
            key={tab.id}
            className="dt"
            role="group"
            aria-label={title}
            data-window-tab={tab.id}
            data-open={open || undefined}
            data-failed={tab.failed || undefined}
          >
            <button
              type="button"
              className="dt-main"
              aria-pressed={open}
              title={`${draft ? 'Entwurf' : 'Mail'}: ${tab.title || (draft ? 'Neue Nachricht, ohne Betreff' : '(kein Betreff)')}${tab.failed ? ' – nicht gespeichert' : ''}`}
              onClick={() => onToggle(tab.id)}
            >
              {draft ? <IconCompose size={14} /> : <IconMail size={14} />}
              <span className="dt-lb">{title}</span>
            </button>
            <button type="button" className="dt-x" aria-label={closeLabel} onClick={() => onClose(tab.id)}>
              <IconClose size={13} />
            </button>
            <span className="dt-tip" aria-hidden="true">
              {closeLabel}
              <small>{title}</small>
            </span>
          </div>
        )
      })}
    </nav>
  )
}

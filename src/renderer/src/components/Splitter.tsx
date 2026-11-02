import { useRef, useState } from 'react'

interface Props {
  /** 'x': Trenner rechts neben der Liste, 'y': Trenner unter ihr */
  axis: 'x' | 'y'
  /** Kleinste erlaubte Groesse der Liste */
  min: number
  /** Groesste erlaubte Groesse, beim Ziehen neu ermittelt - das Fenster kann sich geaendert haben */
  max: () => number
  /** Waehrend des Ziehens, ohne zu speichern */
  onLive: (size: number) => void
  /** Beim Loslassen */
  onCommit: (size: number) => void
  /** Doppelklick: zurueck auf die Standardgroesse */
  onReset: () => void
}

/**
 * Griff zum Verschieben der Grenze zwischen Liste und Lesebereich. Sitzt am
 * Rand der Liste und misst deren aktuelle Groesse beim Zugreifen, statt sich
 * eine zu merken.
 */
export function Splitter({ axis, min, max, onLive, onCommit, onReset }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)
  const drag = useRef<{ start: number; size: number; last: number } | null>(null)

  const clamp = (size: number): number => Math.round(Math.max(min, Math.min(max(), size)))
  const listSize = (): number => {
    const rect = ref.current?.parentElement?.getBoundingClientRect()
    return rect ? (axis === 'x' ? rect.width : rect.height) : min
  }

  return (
    <div
      ref={ref}
      className="splitter"
      data-axis={axis}
      data-active={active}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label="Grenze zwischen Liste und Nachricht verschieben"
      title="Ziehen zum Verschieben, Doppelklick stellt zurueck"
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        const size = listSize()
        drag.current = { start: axis === 'x' ? event.clientX : event.clientY, size, last: size }
        setActive(true)
        // Sonst schluckt der Nachrichtenrahmen die Maus, sobald sie darueberfaehrt.
        document.body.classList.add('resizing')
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (!current) return
        const delta = (axis === 'x' ? event.clientX : event.clientY) - current.start
        current.last = clamp(current.size + delta)
        onLive(current.last)
      }}
      onPointerUp={(event) => {
        const current = drag.current
        drag.current = null
        setActive(false)
        document.body.classList.remove('resizing')
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
        if (current && current.last !== current.size) onCommit(current.last)
      }}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const grow = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
        const shrink = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
        if (event.key !== grow && event.key !== shrink) return
        event.preventDefault()
        const next = clamp(listSize() + (event.key === grow ? 24 : -24))
        onLive(next)
        onCommit(next)
      }}
    />
  )
}

import { useRef, useState } from 'react'

interface Props {
  /** 'x': Trenner rechts neben der Liste, 'y': Trenner unter ihr */
  axis: 'x' | 'y'
  /** Kleinste erlaubte Größe der Liste */
  min: number
  /** Größte erlaubte Größe, beim Ziehen neu ermittelt - das Fenster kann sich geändert haben */
  max: () => number
  /** Während des Ziehens, ohne zu speichern */
  onLive: (size: number) => void
  /** Beim Loslassen und nach jeder Pfeiltaste */
  onCommit: (size: number) => void
  /** Doppelklick: zurück auf die Standardgröße */
  onReset: () => void
}

/** Pfeiltasten verschieben um so viel. */
const STEP = 16

/**
 * Griff zum Verschieben der Grenze zwischen Liste und Lesebereich. In Ruhe nur
 * die Linie; beim Überfahren erscheint der Griff, beim Ziehen wird beides
 * zum Akzent und eine Blase nennt die Größe. Misst die Liste beim Zugreifen,
 * statt sich eine Größe zu merken.
 */
export function Splitter({ axis, min, max, onLive, onCommit, onReset }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragSize, setDragSize] = useState<number | null>(null)
  const [size, setSize] = useState<number | null>(null)
  const drag = useRef<{ start: number; size: number; last: number } | null>(null)

  const clamp = (value: number): number => Math.round(Math.max(min, Math.min(max(), value)))
  const listSize = (): number => {
    const rect = ref.current?.parentElement?.getBoundingClientRect()
    return rect ? Math.round(axis === 'x' ? rect.width : rect.height) : min
  }

  return (
    <div
      ref={ref}
      className="lv-sp"
      data-axis={axis}
      data-drag={dragSize !== null || undefined}
      role="separator"
      tabIndex={0}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={axis === 'x' ? 'Breite der Liste' : 'Höhe der Liste'}
      aria-valuenow={size ?? undefined}
      aria-valuemin={min}
      title="Ziehen ändert die Größe, Doppelklick setzt sie zurück"
      onFocus={() => setSize(listSize())}
      onPointerEnter={() => setSize(listSize())}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        const start = listSize()
        drag.current = { start: axis === 'x' ? event.clientX : event.clientY, size: start, last: start }
        setDragSize(start)
        // Sonst schluckt der Nachrichtenrahmen die Maus, sobald sie darüberfährt.
        document.body.classList.add('resizing')
        document.body.dataset.resizeAxis = axis
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (!current) return
        const delta = (axis === 'x' ? event.clientX : event.clientY) - current.start
        current.last = clamp(current.size + delta)
        setDragSize(current.last)
        onLive(current.last)
      }}
      onPointerUp={(event) => {
        const current = drag.current
        drag.current = null
        setDragSize(null)
        document.body.classList.remove('resizing')
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
        if (current) setSize(current.last)
        if (current && current.last !== current.size) onCommit(current.last)
      }}
      onDoubleClick={() => {
        onReset()
        requestAnimationFrame(() => setSize(listSize()))
      }}
      onKeyDown={(event) => {
        const grow = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
        const shrink = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
        if (event.key !== grow && event.key !== shrink) return
        event.preventDefault()
        const next = clamp(listSize() + (event.key === grow ? STEP : -STEP))
        setSize(next)
        onLive(next)
        onCommit(next)
      }}
    >
      <i aria-hidden="true" />
      {dragSize !== null && <b aria-hidden="true">{dragSize} px</b>}
    </div>
  )
}

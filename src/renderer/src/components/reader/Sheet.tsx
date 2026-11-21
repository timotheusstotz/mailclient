import { useEffect, useRef, useState } from 'react'
import type { ZoomStep } from '../../lib/zoom'
import { IconAlert, IconReset } from '../icons'
import { MailFrame } from './MailFrame'

/** Was das Blatt gerade zeigt. `wait`: die ersten 150 ms des Ladens, noch nichts. */
export type SheetPhase = 'wait' | 'skeleton' | 'error' | 'ready'

/** Der Inhalt, fertig zum Zeigen: ein Dokument fuer den Rahmen oder reiner Text als HTML. */
export type SheetContent = { kind: 'html'; doc: string } | { kind: 'plain'; html: string }

interface SheetProps {
  phase: SheetPhase
  content: SheetContent | null
  zoom: number
  sheetWidth: number
  onContentWidth: (width: number) => void
  onZoomStep: (step: ZoomStep) => void
  onRetry: () => void
}

/**
 * Das weisse Blatt unter Kopf, Hinweisen und Anhaengen. Laedt die Mail, zeigt
 * es graue Zeilen; ging das Laden schief, steht an seiner Stelle die Meldung,
 * auf dem Grund des Themes statt auf Weiss.
 */
export function Sheet({ phase, content, zoom, sheetWidth, onContentWidth, onZoomStep, onRetry }: SheetProps) {
  if (phase === 'error') {
    return (
      <div className="rv-sheet-error" style={{ zoom }}>
        <div className="rv-statenote" role="alert">
          <div className="rv-mark rv-mark--danger">
            <IconAlert size={20} />
          </div>
          <div className="rv-statenote-body">
            <div>
              <h2>Diese Nachricht ließ sich nicht laden.</h2>
              <p>Der Server hat nicht geantwortet. Meist klappt es beim zweiten Versuch.</p>
            </div>
            <button type="button" className="rv-btn rv-btn--outline" onClick={onRetry}>
              <IconReset />
              Erneut versuchen
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rv-sheet" aria-busy={phase === 'skeleton' || phase === 'wait'}>
      {phase === 'skeleton' && <Skeleton zoom={zoom} />}
      {phase === 'ready' && content?.kind === 'html' && (
        <MailFrame
          html={content.doc}
          zoom={zoom}
          sheetWidth={sheetWidth}
          onContentWidth={onContentWidth}
          onZoomStep={onZoomStep}
        />
      )}
      {phase === 'ready' && content?.kind === 'plain' && (
        <div
          className="rv-plain"
          style={{ zoom }}
          // Der Text wurde beim Umwandeln maskiert; nur Links und Zitatbloecke sind HTML.
          dangerouslySetInnerHTML={{ __html: content.html }}
        />
      )}
      {phase === 'ready' && !content && (
        <p className="rv-plain rv-plain--empty" style={{ zoom }}>
          Diese Nachricht hat keinen Text.
        </p>
      )}
    </div>
  )
}

const SKELETON_LINES: Array<[width: string, height: number, gap?: number]> = [
  ['38%', 22],
  ['92%', 12, 12],
  ['86%', 12],
  ['90%', 12],
  ['64%', 12],
  ['88%', 12, 18],
  ['72%', 12],
  ['40%', 12]
]

function Skeleton({ zoom }: { zoom: number }) {
  return (
    <div className="rv-sk-lines" style={{ zoom }} aria-label="Nachricht wird geladen" role="status">
      {SKELETON_LINES.map(([width, height, gap], i) => (
        <div key={i} className="rv-sk" style={{ width, height, marginTop: gap }} />
      ))}
    </div>
  )
}

/** Erst nach so langer Ladezeit erscheinen die grauen Zeilen; ein schneller Abruf zeigt sie nie. */
const SKELETON_DELAY_MS = 150
/** Einmal sichtbar, bleiben sie so lange stehen - sonst flackern sie nur auf. */
const SKELETON_MIN_MS = 300

/** Ob die grauen Zeilen gerade stehen sollen, solange `waiting` gilt. */
export function useSkeleton(waiting: boolean): boolean {
  const [shown, setShown] = useState(false)
  const shownAt = useRef(0)

  useEffect(() => {
    if (waiting) {
      if (shown) return
      const timer = window.setTimeout(() => {
        shownAt.current = Date.now()
        setShown(true)
      }, SKELETON_DELAY_MS)
      return () => window.clearTimeout(timer)
    }
    if (!shown) return
    const rest = SKELETON_MIN_MS - (Date.now() - shownAt.current)
    const timer = window.setTimeout(() => setShown(false), Math.max(0, rest))
    return () => window.clearTimeout(timer)
  }, [shown, waiting])

  return shown
}

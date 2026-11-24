import { IconClose, IconMinimize } from '../icons'

/**
 * Rechts im Kopf jedes Fensters: Minimieren und Schliessen. Gescheitertes
 * Speichern stellt das X scharf: dann sagt es, dass der naechste Klick ohne
 * Speichern schliesst.
 */
export function WindowControls({
  closeTitle,
  armed = false,
  onMinimize,
  onClose
}: {
  /** Tooltip des X mit Kuerzel */
  closeTitle: string
  armed?: boolean
  onMinimize: () => void
  onClose: () => void
}) {
  return (
    <>
      <button
        type="button"
        className="rv-btn rv-btn--icon"
        aria-label="Minimieren"
        title="In die Leiste legen (Klick daneben)"
        onClick={onMinimize}
      >
        <IconMinimize />
      </button>
      <span className="rv-wrap">
        <button
          type="button"
          className={`rv-btn rv-btn--icon${armed ? ' is-armed' : ''}`}
          aria-label={armed ? 'Ohne Speichern schließen' : 'Schließen'}
          title={armed ? undefined : closeTitle}
          onClick={onClose}
        >
          <IconClose />
        </button>
        {armed && (
          <span className="cw-tip" role="tooltip">
            Noch einmal klicken schließt ohne Speichern
          </span>
        )}
      </span>
    </>
  )
}

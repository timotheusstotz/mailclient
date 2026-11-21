import { useEffect, useState, type ReactNode } from 'react'
import type { SyncFeedback, SyncStatus } from '../../state'
import { IconAlert, IconCheck, IconReset, IconSpinner } from '../icons'

interface Props {
  /** Was gezeigt wird; im schmalen Fenster das Ordnermenü */
  title: ReactNode
  meta: string
  /** Rechts statt des Abrufstands, etwa "Alle auswählen" */
  action?: ReactNode
  sync: SyncFeedback
}

/** Die Unterzeile der Liste: links was gezeigt wird, rechts, wie aktuell es ist. */
export function SubHead({ title, meta, action, sync }: Props) {
  return (
    <div className="lv-sub">
      {typeof title === 'string' ? <h2 className="lv-title">{title}</h2> : title}
      {meta && <span className="lv-meta">{meta}</span>}
      <span className="lv-grow" />
      {action !== undefined ? action : <SyncLine status={sync.status} onRetry={sync.retry} />}
    </div>
  )
}

/**
 * Der Abrufstand. Er steht immer im Baum (role="status" meldet nur Änderungen);
 * "Aktuell" blendet nach ein paar Sekunden aus, der zuletzt gezeigte Text
 * bleibt dabei stehen, bis er unsichtbar ist.
 */
function SyncLine({ status, onRetry }: { status: SyncStatus; onRetry: () => void }) {
  const [last, setLast] = useState<SyncStatus>(status)
  useEffect(() => {
    if (status.kind !== 'idle') setLast(status)
  }, [status])
  const shown = status.kind === 'idle' ? last : status

  return (
    <span className="lv-sync-wrap" role="status" data-hidden={status.kind === 'idle' || undefined}>
      {shown.kind === 'busy' && (
        <span className="lv-sync lv-sync--busy">
          <IconSpinner size={14} className="lv-busy" />
          Wird abgerufen …
        </span>
      )}
      {shown.kind === 'done' && (
        <span className="lv-sync">
          <IconCheck size={14} />
          Aktuell
        </span>
      )}
      {shown.kind === 'error' && (
        <>
          <span className="lv-sync lv-sync--err" title={shown.detail}>
            <IconAlert size={14} />
            {shown.text}
          </span>
          {status.kind === 'error' && (
            <button type="button" className="rv-btn rv-btn--s lv-retry" title="Noch einmal abrufen" onClick={onRetry}>
              <IconReset size={14} />
              Erneut
            </button>
          )}
        </>
      )}
    </span>
  )
}

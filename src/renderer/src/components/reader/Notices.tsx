import { dayTime, savedDay } from '../../lib/format'
import { IconClock, IconCompose, IconImage, IconImageOff, IconUndo } from '../icons'

/** Ein Entwurf im Lesebereich: noch nicht gesendet, und wann zuletzt gespeichert. */
export function DraftNotice({ savedAt }: { savedAt: number }) {
  return (
    <div className="rv-note rv-note--draft">
      <IconCompose size={15} className="rv-note-icon" />
      <span className="rv-note-text">
        Entwurf, noch nicht gesendet · gespeichert <b>{savedDay(savedAt)}</b>
      </span>
    </div>
  )
}

/** Zurueckgestellt: bis wann, und der Weg zurueck. */
export function SnoozeNotice({ until, onUnsnooze }: { until: number; onUnsnooze: () => void }) {
  return (
    <div className="rv-note" role="status">
      <IconClock className="rv-note-icon" />
      <span className="rv-note-text">
        Zurückgestellt bis <b>{dayTime(until)}</b>
      </span>
      <div className="rv-note-acts">
        <button type="button" className="rv-btn rv-btn--s" onClick={onUnsnooze}>
          <IconUndo />
          Jetzt zurückholen
        </button>
      </div>
    </div>
  )
}

/**
 * Blockierte Bilder aus dem Netz: Absender erkennen daran, wann eine Mail
 * geoeffnet wird. Laden gilt fuer diese Mail, "Immer von" fuer die Domain.
 */
export function RemoteNotice({
  count,
  domain,
  onAllow,
  onTrust
}: {
  count: number
  /** Absenderdomain; leer, wenn sie sich nicht bestimmen liess */
  domain: string
  onAllow: () => void
  onTrust: () => void
}) {
  return (
    <div className="rv-note" role="status">
      <IconImageOff className="rv-note-icon" />
      <span className="rv-note-text">
        <b>{count === 1 ? '1 externes Bild' : `${count} externe Bilder`}</b> blockiert
      </span>
      <div className="rv-note-acts">
        <button type="button" className="rv-btn rv-btn--s rv-btn--outline" onClick={onAllow}>
          <IconImage />
          Bilder laden
        </button>
        {domain && (
          <button
            type="button"
            className="rv-btn rv-btn--s"
            onClick={onTrust}
            title={`Bilder von ${domain} künftig ohne Nachfrage laden`}
          >
            Immer von {domain}
          </button>
        )}
      </div>
    </div>
  )
}

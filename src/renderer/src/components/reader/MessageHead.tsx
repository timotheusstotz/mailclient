import { useState } from 'react'
import type { Address, MessageSummary } from '@shared/types'
import { displayName, formatAddressFull, headDate } from '../../lib/format'

/** So viele Empfaenger stehen da, bevor "und n weitere" den Rest einklappt. */
const SHOWN_PEOPLE = 4

/**
 * Kopf der Mail: Betreff (hoechstens zwei Zeilen), darunter Von, An und, wenn
 * es eine gibt, Kopie an - mit einer Spalte fuer die Bezeichnungen.
 */
export function MessageHead({ message, ownAddress }: { message: MessageSummary; ownAddress?: string }) {
  const sender = message.from[0]
  return (
    <header className="rv-head">
      <h1 className="rv-subject" title={message.subject}>
        {message.subject || '(kein Betreff)'}
      </h1>
      <div className="rv-meta">
        <div className="rv-mrow rv-mrow--from">
          <span className="rv-k">Von</span>
          <span className="rv-v">
            <span className="rv-name">{displayName(sender)}</span>
            {sender?.name && <span className="rv-addr">{sender.address}</span>}
          </span>
          <span className="rv-date">{headDate(message.date)}</span>
        </div>
        <div className="rv-mrow">
          <span className="rv-k">An</span>
          <span className="rv-v">
            {message.to.length ? (
              <People list={message.to} />
            ) : (
              <span className="rv-person">{ownAddress || 'unbekannt'}</span>
            )}
          </span>
        </div>
        {message.cc.length > 0 && (
          <div className="rv-mrow">
            <span className="rv-k">Kopie an</span>
            <span className="rv-v">
              <People list={message.cc} />
            </span>
          </div>
        )}
      </div>
    </header>
  )
}

/** Die ersten vier, dann ein Knopf, der den Rest an Ort und Stelle aufklappt. */
function People({ list }: { list: Address[] }) {
  const [open, setOpen] = useState(false)
  const shown = open ? list : list.slice(0, SHOWN_PEOPLE)
  const rest = list.length - shown.length
  return (
    <span className="rv-people">
      {shown.map((person, i) => (
        <span key={`${person.address}-${i}`} className="rv-person" title={formatAddressFull(person)}>
          {displayName(person)}
        </span>
      ))}
      {rest > 0 && (
        <button type="button" className="rv-more" onClick={() => setOpen(true)}>
          und {rest} weitere
        </button>
      )}
    </span>
  )
}

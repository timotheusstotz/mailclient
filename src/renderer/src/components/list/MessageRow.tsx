import { memo, type ReactNode } from 'react'
import type { MessageSummary } from '@shared/types'
import type { ThreadRow } from '@shared/threads'
import { shortDate, snoozeTag } from '../../lib/format'
import { endMailDrag, useMailDrag } from '../../lib/mailDrag'
import { IconCheck, IconClock, IconPaperclip, IconStarFilled, IconUndo } from '../icons'

export interface RowProps {
  row: ThreadRow
  /** Wer in der Zeile steht: Absender, in Gesendet und Entwürfen der Empfänger */
  partner: string

  /** Ordner als Etikett, nur in Suchergebnissen außerhalb des Posteingangs */
  folderTag?: string
  /** Mails der Unterhaltung, auch die in anderen Ordnern; 1 ohne Zusammenfassen */
  count: number
  /** Die Zeile im Lesebereich */
  open: boolean
  /** Ihr Kontextmenue ist offen */
  menuOpen?: boolean
  /** Mehrere ausgewählt: Kästchen statt Punkt */
  selecting: boolean
  /** In der Mehrfachauswahl angehakt */
  picked: boolean
  /** Der Punkt ist per Tab erreichbar; nur bei einer Zeile, sonst wären es Hunderte Tabstopps */
  tabbable: boolean
  comfortable: boolean
  /** Statt des Vorschautexts, etwa die Dateinamen unter "Anhänge" */
  snippet: string
  /** Suchwörter, im Absender und im Betreff hervorgehoben */
  marks: { from: string[]; subject: string[] }
  onClick: (message: MessageSummary, event: React.MouseEvent) => void
  /** Kästchen in der Mehrfachauswahl: schaltet nur diese Zeile um */
  onTogglePick: (message: MessageSummary) => void
  onContextMenu: (event: React.MouseEvent, message: MessageSummary) => void
  onToggleRead: (message: MessageSummary) => void
  /** Die Zeile wird gezogen: was mitgeht, entscheidet die Auswahl */
  onDragStart: (event: React.DragEvent, message: MessageSummary) => void
}

/**
 * Eine Zeile der Liste: Absender und Datum, Betreff und Marken, Vorschau. Links
 * in der Rinne der Punkt für ungelesen, ein echter Knopf, der nur den Status
 * umschaltet; in der Mehrfachauswahl steht dort ein Kästchen.
 */
export const MessageRow = memo(function MessageRow(props: RowProps) {
  const { row } = props
  const head = row.head
  const unread = row.members.some((m) => !m.flags.includes('\\Seen'))
  const flagged = row.members.some((m) => m.flags.includes('\\Flagged'))
  const attachment = row.members.some((m) => m.hasAttachments)
  const subject = head.subject || '(kein Betreff)'
  const readLabel = unread ? 'Als gelesen markieren' : 'Als ungelesen markieren'
  // Die gezogenen Zeilen treten zurueck, solange sie unterwegs sind.
  const drag = useMailDrag()
  const lifted = drag ? row.members.some((m) => drag.ids.has(m.id)) : false

  return (
    <div
      className="lv-r"
      role="option"
      tabIndex={-1}
      aria-selected={props.selecting ? props.picked : props.open}
      data-unread={unread}
      data-open={props.open || undefined}
      data-lifted={lifted || undefined}
      data-menu={props.menuOpen || undefined}
      data-picked={(props.selecting && props.picked) || undefined}

      draggable
      onDragStart={(event) => props.onDragStart(event, head)}
      onDragEnd={() => endMailDrag()}
      onClick={(event) => props.onClick(head, event)}
      onContextMenu={(event) => props.onContextMenu(event, head)}
    >

      {props.selecting ? (
        <span
          className="lv-cb"
          aria-hidden="true"
          data-on={props.picked || undefined}
          onClick={(event) => {
            event.stopPropagation()
            props.onTogglePick(head)
          }}
        >
          {props.picked && <IconCheck size={12} />}
        </span>
      ) : (
        <button
          type="button"
          className="lv-dot"
          tabIndex={props.tabbable ? 0 : -1}
          aria-pressed={unread}
          aria-label={readLabel}
          title={readLabel}
          onClick={(event) => {
            // Der Punkt schaltet nur den Status um; die Zeile soll sich davon nicht ausgewählt fühlen.
            event.stopPropagation()
            props.onToggleRead(head)
          }}
        />
      )}
      <span className="lv-r-from">
        <span className="lv-r-nm" title={props.partner}>
          {mark(props.partner, props.marks.from)}
        </span>
        {props.count > 1 && (
          <span className="lv-r-cnt" title={`Unterhaltung mit ${props.count} Nachrichten`}>
            {props.count}
          </span>
        )}
      </span>

      <span className="lv-r-date">{shortDate(head.date)}</span>
      <span className="lv-r-subj" title={subject}>
        {mark(subject, props.marks.subject)}
      </span>
      <span className="lv-r-marks">
        {props.folderTag && <span className="lv-r-tag">{props.folderTag}</span>}
        {head.snoozedUntil !== undefined &&
          (head.snoozeOver ? (
            <span className="lv-r-tag lv-r-tag--back">
              <IconUndo size={12} />
              Wieder da
            </span>
          ) : (
            <span className="lv-r-tag">
              <IconClock size={12} />
              {snoozeTag(head.snoozedUntil)}
            </span>
          ))}
        {attachment && (
          <span role="img" aria-label="Mit Anhang" title="Mit Anhang">
            <IconPaperclip size={14} />
          </span>
        )}
        {flagged && (
          <span role="img" aria-label="Markiert" title="Markiert" className="lv-r-star">
            <IconStarFilled size={14} />
          </span>
        )}
      </span>
      {props.comfortable && <span className="lv-r-snip">{props.snippet}</span>}
    </div>
  )
})

/** Hebt jedes Vorkommen der Suchwörter hervor, ohne Rücksicht auf Groß und klein. */
function mark(text: string, needles: string[]): ReactNode {
  const words = needles.filter(Boolean)
  if (!words.length) return text
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  const parts = text.split(pattern)
  if (parts.length === 1) return text
  return parts.map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part))
}

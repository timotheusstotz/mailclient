import { memo, useRef, type ReactNode } from 'react'
import type { MessageSummary } from '@shared/types'
import type { ThreadRow } from '@shared/threads'
import { shortDate, snoozeTag } from '../../lib/format'
import { endMailDrag, useMailDrag } from '../../lib/mailDrag'
import { useLeaving, useRowLeave } from '../../lib/listMotion'
import { IconCheck, IconClock, IconPaperclip, IconStarFilled, IconTrash, IconUndo } from '../icons'

export interface RowProps {
  row: ThreadRow
  /** Wer in der Zeile steht: Absender, in Gesendet der Empfänger, in Entwürfen der erste Empfänger (leer ohne) */
  partner: string
  /** Ein Entwurf: "An" vor dem Empfänger, kein Punkt für ungelesen, Doppelklick schreibt weiter */
  draft?: boolean

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
  /** Doppelklick: in einem eigenen Fenster oeffnen (ein Entwurf: weiterschreiben) */
  onOpen: (message: MessageSummary) => void
  /** Kästchen in der Mehrfachauswahl: schaltet nur diese Zeile um */
  onTogglePick: (message: MessageSummary) => void
  onContextMenu: (event: React.MouseEvent, message: MessageSummary) => void
  onToggleRead: (message: MessageSummary) => void
  /** Der Papierkorb beim Hovern; fehlt im Papierkorb selbst. */
  onTrash?: (message: MessageSummary) => void
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
  const unread = !props.draft && row.members.some((m) => !m.flags.includes('\\Seen'))
  const flagged = row.members.some((m) => m.flags.includes('\\Flagged'))
  const attachment = row.members.some((m) => m.hasAttachments)
  const subject = head.subject || (props.draft ? 'Kein Betreff' : '(kein Betreff)')
  const readLabel = unread ? 'Als gelesen markieren' : 'Als ungelesen markieren'
  // Die gezogenen Zeilen treten zurueck, solange sie unterwegs sind.
  const drag = useMailDrag()
  const lifted = drag ? row.members.some((m) => drag.ids.has(m.id)) : false
  // Geloescht oder verschoben: die Zeile blendet aus und klappt zu, bis die Daten sie entfernen.
  const ref = useRef<HTMLDivElement>(null)
  const memberIds = row.members.map((m) => m.id)
  const leaving = useLeaving(memberIds)
  useRowLeave(ref, leaving, memberIds)

  // Bei Mehrfachauswahl hat das Auswahlfeld rechts die Aktionen.
  const trashable = Boolean(props.onTrash) && !props.selecting

  return (
    <div
      ref={ref}
      className="lv-r"
      data-row={head.id}
      role="option"
      tabIndex={-1}
      aria-selected={props.selecting ? props.picked : props.open}
      data-unread={unread}
      data-open={props.open || undefined}
      data-lifted={lifted || undefined}
      data-leaving={leaving?.kind}
      data-lift={leaving?.lift || undefined}
      data-menu={props.menuOpen || undefined}
      data-picked={(props.selecting && props.picked) || undefined}
      data-del={trashable || undefined}

      draggable
      onDragStart={(event) => props.onDragStart(event, head)}
      onDragEnd={() => endMailDrag()}
      onClick={(event) => props.onClick(head, event)}
      title={props.draft ? 'Doppelklick öffnet den Entwurf zum Weiterschreiben' : undefined}
      onDoubleClick={() => props.onOpen(head)}
      onContextMenu={(event) => props.onContextMenu(event, head)}
    >

      {props.draft && !props.selecting ? null : props.selecting ? (
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
        {props.draft ? (
          <span className="lv-r-nm" title={props.partner || undefined}>
            {props.partner ? (
              <>
                <span className="lv-r-pre">An</span>
                {mark(props.partner, props.marks.from)}
              </>
            ) : (
              <span className="lv-none">Kein Empfänger</span>
            )}
          </span>
        ) : (
          <span className="lv-r-nm" title={props.partner}>
            {mark(props.partner, props.marks.from)}
          </span>
        )}
        {props.count > 1 && (
          <span className="lv-r-cnt" title={`Unterhaltung mit ${props.count} Nachrichten`}>
            {props.count}
          </span>
        )}
      </span>

      <span className="lv-r-date">{shortDate(head.date)}</span>
      <span className="lv-r-subj" title={subject}>
        {props.draft && !head.subject ? <span className="lv-none">Kein Betreff</span> : mark(subject, props.marks.subject)}
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
      {/* Nur am rechten Rand faehrt der Papierkorb heraus, nicht ueber der ganzen Zeile (Tim). */}
      {trashable && <span className="lv-r-delzone" aria-hidden="true" />}
      {trashable && (
        <button
          type="button"
          className="lv-r-del"
          tabIndex={props.tabbable ? 0 : -1}
          aria-label="In den Papierkorb"
          title="In den Papierkorb (Entf)"
          onClick={(event) => {
            // Nur loeschen - die Zeile soll davon weder ausgewaehlt noch geoeffnet werden.
            event.stopPropagation()
            props.onTrash?.(head)
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <IconTrash size={18} />
          Papierkorb
        </button>
      )}
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

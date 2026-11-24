import { useLayoutEffect, useRef, useState } from 'react'
import type { Attachment, MessageBody, MessageSummary } from '@shared/types'
import { fileSize } from '../../lib/format'
import { IconDownload, IconPaperclip } from '../icons'

/** So viele Reihen Kacheln stehen da, bevor "+ n weitere" den Rest einklappt. */
const SHOWN_ROWS = 2

/**
 * Anhaenge stehen ueber dem Text, nicht darunter: sie sind oft der eigentliche
 * Inhalt der Mail. Ein Klick auf die Kachel oeffnet die Datei, der Knopf rechts
 * speichert sie. Mehr als zwei Reihen klappen ein; die letzte sichtbare Stelle
 * zeigt dann, wie viele noch kommen.
 */
export function Attachments({
  message,
  body,
  onSaveAll
}: {
  message: MessageSummary
  body: MessageBody
  onSaveAll: () => void
}) {
  const list = body.attachments
  const total = list.reduce((sum, att) => sum + att.size, 0)
  const gridRef = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(3)
  const [expanded, setExpanded] = useState(false)

  // Wie viele Spalten das Raster gerade hat, liest es selbst am besten ab: so
  // gilt auch die schmale Kachelbreite aus der Container-Abfrage.
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const read = (): void => {
      const tracks = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
      setColumns(Math.max(1, tracks))
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [])

  const slots = columns * SHOWN_ROWS
  const folded = !expanded && list.length > slots
  const first = folded ? list.slice(0, slots - 1) : list.slice(0, slots)
  const rest = expanded ? list.slice(slots) : []
  const tile = (att: Attachment) => (
    <AttachmentTile key={att.partId} message={message} attachment={att} preview={body.previews?.[att.partId]} />
  )

  return (
    <section className="rv-att" aria-label="Anhänge">
      <div className="rv-att-head">
        <IconPaperclip size={14} />
        <span>
          {list.length === 1 ? '1 Anhang' : `${list.length} Anhänge`} · {fileSize(total)}
        </span>
        {list.length > 1 && (
          <button type="button" className="rv-btn rv-btn--s" onClick={onSaveAll}>
            <IconDownload />
            Alle speichern
          </button>
        )}
      </div>
      <div className="rv-att-grid" ref={gridRef}>
        {first.map(tile)}
        {folded && (
          <button type="button" className="rv-tile-more" onClick={() => setExpanded(true)}>
            + {list.length - first.length} weitere
          </button>
        )}
      </div>
      {rest.length > 0 && (
        <div className="rv-att-rest">
          <div className="rv-att-grid">{rest.map(tile)}</div>
        </div>
      )}
    </section>
  )
}

function AttachmentTile({
  message,
  attachment,
  preview
}: {
  message: MessageSummary
  attachment: Attachment
  preview?: string
}) {
  const { accountId, folder, uid } = message
  const { partId, filename } = attachment
  const kind = fileKind(filename, attachment.contentType)
  return (
    <div className="rv-tile">
      <button
        type="button"
        className="rv-tile-open"
        title={`${filename} öffnen`}
        onClick={() => void window.api.attachments.open(accountId, folder, uid, partId, filename)}
      >
        <span className={`rv-thumb rv-thumb--${kind.tone}`}>
          {preview ? <img src={preview} alt="" draggable={false} /> : kind.label}
        </span>
        <span className="rv-ttext">
          <span className="rv-tname">{filename}</span>
          <span className="rv-tsize">{fileSize(attachment.size)}</span>
        </span>
      </button>
      <button
        type="button"
        className="rv-btn rv-btn--icon rv-tile-save"
        aria-label={`${filename} speichern`}
        title="Speichern"
        onClick={() => void window.api.attachments.save(accountId, folder, uid, partId, filename)}
      >
        <IconDownload />
      </button>
    </div>
  )
}

/** Kurzes Kuerzel und Farbe fuer Dateien ohne Bildvorschau, z. B. "PDF" auf Rot. */
export function fileKind(filename: string, contentType: string): { label: string; tone: string } {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(filename)?.[1]
  const fromType = contentType.split('/')[1]?.split(/[;+]/)[0]
  const label = (fromName || fromType || 'Datei').toUpperCase().slice(0, 4)
  if (label === 'PDF') return { label, tone: 'pdf' }
  if (['DOC', 'DOCX', 'ODT', 'RTF'].includes(label)) return { label, tone: 'doc' }
  if (label === 'ICS' || contentType.startsWith('text/calendar')) return { label, tone: 'ics' }
  if (contentType.startsWith('image/')) return { label, tone: 'img' }
  return { label, tone: 'plain' }
}

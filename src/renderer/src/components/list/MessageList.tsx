import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { Account, Folder, MessageSummary, Settings, ViewRef } from '@shared/types'
import type { ThreadRow } from '@shared/threads'
import { parseSearch } from '@shared/search'
import { displayName, folderLabel, listPartner } from '../../lib/format'
import type { SyncFeedback } from '../../state'
import { useLingeringRows } from '../../lib/listMotion'
import { IconRefresh } from '../icons'
import { EmptyList } from './EmptyList'
import { MessageRow } from './MessageRow'
import { SearchField } from './SearchField'
import { SubHead } from './SubHead'

interface Props {
  /** Eine Zeile je Unterhaltung; ohne Zusammenfassen hat jede Zeile genau eine Mail */
  rows: ThreadRow[]
  /** Zähler für Unterhaltungen zeigen */
  threaded: boolean
  loading: boolean
  /** Was die Liste zeigt, die Suche eingerechnet */
  view: ViewRef
  accountsById: Map<string, Account>
  folderByKey: Map<string, Folder>
  settings: Settings
  selectedId: string | null
  /** Zeile mit offenem Kontextmenue */
  menuRowId?: string | null
  /** Alle markierten Zeilen; enthält selectedId immer mit */
  selectedIds: Set<string>
  searchText: string
  /** Wo gesucht wird, für die Hilfe zur Suche */
  searchScope: string
  sync: SyncFeedback
  /** Links in der Unterzeile: Titel oder Ordnermenü */
  title: ReactNode
  meta: string
  /** Rechts in der Unterzeile statt des Abrufstands */
  subAction?: ReactNode
  onSearchChange: (value: string) => void
  onSelect: (message: MessageSummary, event: React.MouseEvent) => void
  onOpen: (message: MessageSummary) => void
  onTogglePick: (message: MessageSummary) => void
  onContextMenu: (event: React.MouseEvent, message: MessageSummary) => void
  onToggleRead: (message: MessageSummary) => void
  onTrash: (message: MessageSummary) => void
  onDragStart: (event: React.DragEvent, message: MessageSummary) => void
  onRefresh: () => void
  onCompose: () => void
  searchInputRef?: React.RefObject<HTMLInputElement | null>
  listRef?: React.RefObject<HTMLElement | null>
  /** Griff zum Verschieben der Grenze zum Lesebereich */
  resizer?: ReactNode
}

/** Die Nachrichtenliste: Suche und Abruf, die Unterzeile, die Zeilen. */
export function MessageList(props: Props) {
  const { rows, view, settings } = props
  // Was eben ging, klappt noch zu, bevor es aus der Liste verschwindet.
  const shownRows = useLingeringRows(rows)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Beim Wechsel der Ansicht wieder nach oben - sonst landet man mitten in einer fremden Liste.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [view])

  // Mit J/K oder den Pfeilen gewählt: die Zeile ins Bild holen.
  useEffect(() => {
    const node = scrollRef.current?.querySelector<HTMLElement>('[data-open]')
    node?.scrollIntoView({ block: 'nearest' })
  }, [props.selectedId])


  const marks = useMemo(() => {
    if (view.kind !== 'search') return { from: [], subject: [] }
    const parsed = parseSearch(view.query.text)
    return { from: [...parsed.from, ...parsed.terms], subject: [...parsed.subject, ...parsed.terms] }
  }, [view])

  const attachmentView = view.kind === 'unified' && view.id === 'attachments'
  const selecting = props.selectedIds.size > 1
  const viewFolder = view.kind === 'folder' ? props.folderByKey.get(`${view.accountId}|${view.folder}`) : undefined

  return (
    <section
      className="lv-ls"
      ref={props.listRef as React.RefObject<HTMLElement>}
      data-density={settings.density}
      aria-label="Nachrichten"
    >
      <div className="lv-ls-head">
        <SearchField value={props.searchText} onChange={props.onSearchChange} inputRef={props.searchInputRef} scope={props.searchScope} />
        <button
          type="button"
          className="rv-btn rv-btn--icon lv-rf"
          aria-label="Jetzt abrufen"
          title="Jetzt abrufen (Strg+R)"
          onClick={props.onRefresh}
        >
          <IconRefresh className={props.sync.busy ? 'lv-busy' : undefined} />
        </button>
      </div>

      <SubHead title={props.title} meta={props.meta} action={props.subAction} sync={props.sync} />

      {rows.length > 0 || props.loading ? (
        <div
          className="lv-scroll"
          ref={scrollRef}
          role="listbox"
          aria-label="Nachrichtenliste"
          aria-multiselectable="true"
          data-selecting={selecting || undefined}
        >
          {shownRows.map((row) => {
            const msg = row.head
            const folder = props.folderByKey.get(`${msg.accountId}|${msg.folder}`)
            const open = row.members.some((m) => m.id === props.selectedId)
            const unread = row.members.some((m) => !m.flags.includes('\\Seen'))
            const files = attachmentView ? (msg.attachmentNames ?? []).join(', ') : ''
            return (
              <MessageRow
                key={msg.id}
                row={row}
                partner={folder?.role === 'drafts' ? (msg.to[0] ? displayName(msg.to[0]) : '') : listPartner(msg, folder?.role)}
                draft={folder?.role === 'drafts'}

                folderTag={view.kind === 'search' && folder && folder.role !== 'inbox' ? folderLabel(folder.name, folder.role) : undefined}
                // Die Zahl meint die ganze Unterhaltung, auch was in Gesendet liegt.
                count={props.threaded ? Math.max(row.members.length, msg.threadSize ?? 1) : 1}
                open={open}
                menuOpen={props.menuRowId === msg.id}
                selecting={selecting}
                picked={props.selectedIds.has(msg.id)}
                tabbable={open || (!props.selectedId && row === rows[0])}
                comfortable={settings.density === 'comfortable'}
                snippet={files || msg.snippet || (unread ? 'Wird geladen' : 'Kein Vorschautext')}
                marks={marks}
                onClick={props.onSelect}
                onOpen={props.onOpen}
                onTogglePick={props.onTogglePick}
                onContextMenu={props.onContextMenu}
                onToggleRead={props.onToggleRead}
                onTrash={props.folderByKey.get(`${msg.accountId}|${msg.folder}`)?.role === 'trash' ? undefined : props.onTrash}
                onDragStart={props.onDragStart}
              />
            )
          })}
        </div>
      ) : (
        <EmptyList
          view={view}
          searchText={props.searchText}
          folder={viewFolder}
          onClearSearch={() => props.onSearchChange('')}
          onCompose={props.onCompose}
        />
      )}
      {props.resizer}
    </section>
  )
}

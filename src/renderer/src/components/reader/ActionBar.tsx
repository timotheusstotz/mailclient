import { useMemo, useState, type ReactNode } from 'react'
import type { Account, Folder } from '@shared/types'
import { moveChoices } from '../../lib/folders'
import { folderLabel } from '../../lib/format'
import {
  IconArchive,
  IconCheck,
  IconChevron,
  IconClock,
  IconFolder,
  IconFolderMove,
  IconForward,
  IconInbox,
  IconMailUnread,
  IconReply,
  IconReplyAll,
  IconSearch,
  IconSent,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconJunk
} from '../icons'
import { MenuButton, MenuItem, useMenuClose } from './Menu'
import { TimeMenu } from './TimeMenu'

export interface ActionBarProps {
  /** Name der Leiste fuer Screenreader */
  label?: string
  /** Was links steht: die Antworten, bei mehreren Mails "Als gelesen markieren" */
  lead: ReactNode
  flagged: boolean
  account?: Account
  /** Ordner, in dem die Mail liegt */
  folder?: Folder
  /** Alle Ordner des Kontos der Mail */
  folders: Folder[]
  /** Gesetzt, wenn sich nicht verschieben laesst: der Grund, fuer den Tooltip */
  moveBlocked?: string
  /** Ein Entwurf: rechts steht nur der Papierkorb */
  draft?: boolean
  onToggleFlag: () => void
  onMarkUnread: () => void
  onSnooze: (until: number) => void
  onAskSnooze: () => void
  onMove: (path: string) => void
  onArchive: () => void
  onDelete: () => void
}

/**
 * Die Leiste ueber der Mail und ueber einer Auswahl mehrerer Mails. Links,
 * was der Aufrufer hineingibt; rechts in drei Gruppen, was mit den Mails
 * geschieht - in beiden Faellen an derselben Stelle. Die Kuerzel in den
 * Tooltips sind die aus App.tsx.
 */
export function ActionBar(props: ActionBarProps) {
  const flagLabel = props.flagged ? 'Markierung entfernen' : 'Markieren'
  return (
    <div className="rv-bar" role="toolbar" aria-label={props.label ?? 'Aktionen'}>
      {props.lead}

      <div className="rv-grow" />

      {!props.draft && (
        <>
          <div className="rv-seg">
            <button
              type="button"
              className={`rv-btn rv-btn--icon${props.flagged ? ' rv-star-on' : ''}`}
              aria-label="Markieren"
              aria-pressed={props.flagged}
              title={`${flagLabel} · S`}
              onClick={props.onToggleFlag}
            >
              {props.flagged ? <IconStarFilled /> : <IconStar />}
            </button>
            <button
              type="button"
              className="rv-btn rv-btn--icon"
              aria-label="Als ungelesen markieren"
              title="Als ungelesen markieren · U"
              onClick={props.onMarkUnread}
            >
              <IconMailUnread />
            </button>
          </div>

          <div className="rv-seg">
            <MenuButton
              label="Zurückstellen"
              title="Zurückstellen · B"
              className="rv-btn rv-btn--menu"
              menuLabel="Zurückstellen bis"
              menuClassName="rv-menu"
              menu={() => (
                <TimeMenu title="Zurückstellen bis" onPick={props.onSnooze} onAskCustom={props.onAskSnooze} />
              )}
            >
              <IconClock />
              <span className="rv-wide-lbl">Zurückstellen</span>
              <IconChevron size={14} className="rv-chev" />
            </MenuButton>
            <MenuButton
              label="Verschieben"
              title={props.moveBlocked ?? 'In Ordner verschieben'}
              disabled={Boolean(props.moveBlocked)}
              className={`rv-btn rv-btn--menu${props.moveBlocked ? ' rv-btn--muted' : ''}`}
              menuLabel="In Ordner verschieben"
              menuClassName="rv-menu rv-menu--move"
              menu={() => (
                <MoveMenu
                  account={props.account}
                  folder={props.folder}
                  folders={props.folders}
                  onMove={props.onMove}
                  onArchive={props.onArchive}
                />
              )}
            >
              <IconFolderMove />
              <span className="rv-wide-lbl">Verschieben</span>
              <IconChevron size={14} className="rv-chev" />
            </MenuButton>
          </div>
        </>
      )}

      <div className="rv-seg">
        {!props.draft && (
          <button
            type="button"
            className="rv-btn rv-btn--wide-icon"
            aria-label="Archivieren"
            title="Archivieren · E"
            onClick={props.onArchive}
          >
            <IconArchive />
            <span className="rv-wide-lbl" aria-hidden="true">
              Archivieren
            </span>
          </button>
        )}
        <button
          type="button"
          className="rv-btn rv-btn--icon rv-btn--danger"
          aria-label="In den Papierkorb"
          title="In den Papierkorb · Entf"
          onClick={props.onDelete}
        >
          <IconTrash />
        </button>
      </div>
    </div>
  )
}

/** Links in der Leiste einer einzelnen Mail: Antworten als einziger gefuellter Knopf. */
export function ReplyActions({
  canReplyAll,
  onReply,
  onReplyAll,
  onForward
}: {
  /** Ob "Allen antworten" mehr erreicht als "Antworten" */
  canReplyAll: boolean
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
}) {
  return (
    <>
      <button type="button" className="rv-btn rv-btn--primary" title="Antworten · R" onClick={onReply}>
        <IconReply />
        Antworten
      </button>
      {canReplyAll && (
        <button type="button" className="rv-btn rv-has-lbl" title="Allen antworten · A" onClick={onReplyAll}>
          <IconReplyAll />
          <span className="rv-lbl">Allen antworten</span>
        </button>
      )}
      <button type="button" className="rv-btn rv-has-lbl" title="Weiterleiten · F" onClick={onForward}>
        <IconForward />
        <span className="rv-lbl">Weiterleiten</span>
      </button>
    </>
  )
}

const roleIcons: Partial<Record<Folder['role'], ReactNode>> = {
  inbox: <IconInbox />,
  archive: <IconArchive />,
  sent: <IconSent />,
  junk: <IconJunk />,
  trash: <IconTrash />
}

function MoveMenu({
  account,
  folder,
  folders,
  onMove,
  onArchive
}: {
  account?: Account
  folder?: Folder
  folders: Folder[]
  onMove: (path: string) => void
  onArchive: () => void
}) {
  const close = useMenuClose()
  const [query, setQuery] = useState('')
  const choices = useMemo(() => moveChoices(folders, folder?.path), [folders, folder?.path])
  const needle = query.trim().toLocaleLowerCase('de')
  const shown = needle
    ? choices.filter((f) => folderLabel(f.name, f.role).toLocaleLowerCase('de').includes(needle))
    : choices
  const pick = (target: Folder): void => {
    if (target.role === 'archive') onArchive()
    else onMove(target.path)
  }

  return (
    <>
      <label className="rv-menu-search">
        <IconSearch />
        <input
          data-autofocus
          type="text"
          value={query}
          placeholder="Ordner suchen"
          aria-label="Ordner suchen"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            event.stopPropagation()
            const first = shown.find((f) => f.path !== folder?.path)
            if (!first) return
            close()
            pick(first)
          }}
        />
        <kbd className="rv-lbl-k" aria-hidden="true">
          Esc
        </kbd>
      </label>
      <div className="rv-menu-scroll">
        {account && (
          <div className="rv-menu-acct" aria-hidden="true">
            <i style={{ background: account.color }} />
            {account.label}
          </div>
        )}
        {shown.map((f) => {
          const current = f.path === folder?.path
          return (
            <MenuItem
              key={f.path}
              current={current}
              icon={current ? <IconCheck /> : (roleIcons[f.role] ?? <IconFolder />)}
              meta={current ? 'aktuell' : f.role === 'archive' ? 'E' : ''}
              onSelect={() => pick(f)}
            >
              {folderLabel(f.name, f.role)}
            </MenuItem>
          )
        })}
        {shown.length === 0 && <div className="rv-menu-empty">Kein Ordner passt zu „{query.trim()}“.</div>}
      </div>
    </>
  )
}

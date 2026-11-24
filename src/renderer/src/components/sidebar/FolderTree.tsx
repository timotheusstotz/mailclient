import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Account, AccountStatus, Folder, MessageSummary, ViewRef } from '@shared/types'
import { accountTone, type Theme } from '../../lib/accountTone'
import { folderRows, splitFolders } from '../../lib/folderTree'
import { folderLabel } from '../../lib/format'
import {
  canDrop,
  clearRefusal,
  draggedMail,
  mailDragState,
  noteSprung,
  refusalNote,
  refuseDrop,
  useMailDrag
} from '../../lib/mailDrag'
import { roleIcon, UNIFIED_VIEWS } from '../../lib/views'
import { IconChevronRight, IconFolder } from '../icons'

export interface FolderTreeProps {
  /** In der Spalte oder im Menü des schmalen Fensters (Einträge sind dann menuitems) */
  mode: 'column' | 'menu'
  accounts: Account[]
  foldersByAccount: Map<string, Folder[]>
  statusById: Map<string, AccountStatus>
  unreadTotal: number
  unreadByAccount: Map<string, number>
  /** Zahlen für "Markiert" und "Zurückgestellt" */
  viewCounts: { flagged: number; snoozed: number }
  /** Die gewählte Ansicht, ohne Suche */
  view: ViewRef
  /** Nur dieses Konto, mit seinem ganzen Baum; leer heißt "Alle Konten" */
  scopeAccountId?: string
  theme: Theme
  /** Ob eine Gruppe offen ist; `fallback`, solange der Nutzer sie nie umgeschaltet hat */
  isOpen: (key: string, fallback: boolean) => boolean
  onToggle: (key: string, open: boolean) => void
  onSelect: (view: ViewRef) => void
  onFolderContextMenu?: (event: React.MouseEvent, accountId: string, folder: Folder) => void
  onAccountContextMenu?: (event: React.MouseEvent, accountId: string) => void
  /** Ab dem wievielten Konto die Gruppen unter "Alle Konten" anfangs zu sind */
  openGroups: number
  /** Gezogene Mails wurden auf einem Ordner abgelegt */
  onDropMail?: (items: MessageSummary[], accountId: string, folder: Folder) => void
}

/** So lange muss eine gezogene Mail ueber einer zugeklappten Gruppe stehen, bis sie aufgeht. */
const HOVER_OPEN_MS = 600

/**
 * Der Ordnerbaum, in der Spalte und im Ordnermenü derselbe.
 *
 * Unter "Alle Konten": die Sammelansichten, dann je Konto eine Gruppe mit den
 * Standardordnern; die eigenen Ordner liegen eingeklappt unter "Eigene Ordner".
 * Mit einem Konto vorn: sein ganzer Baum, erst die Standardordner, nach einer
 * Linie die eigenen in der Reihenfolge des Servers.
 */
export function FolderTree(props: FolderTreeProps) {
  const { view, scopeAccountId } = props
  const menu = props.mode === 'menu'
  const isFolder = (accountId: string, path: string): boolean =>
    view.kind === 'folder' && view.accountId === accountId && view.folder === path
  const labelOf = (accountId: string): string => props.accounts.find((a) => a.id === accountId)?.label ?? 'diesem Konto'
  const dragging = Boolean(props.onDropMail) && !menu
  /** Klappt beim Verweilen einer gezogenen Mail auf und nach dem Ziehen wieder zu. */
  const springFor = (key: string, accountId: string, open: boolean): Spring | undefined =>
    dragging && !open
      ? { key, accountId, open: () => props.onToggle(key, true), close: () => props.onToggle(key, false) }
      : undefined

  const folderButton = (account: Account, folder: Folder, level: number, parent: boolean) => {
    const key = `folder:${account.id}|${folder.path}`
    const open = props.isOpen(key, true)
    return (
      <FolderRow
        key={folder.path}
        menu={menu}
        level={level}
        icon={roleIcon(folder.role)}
        label={folderLabel(folder.name, folder.role)}
        title={folder.path}
        // Daran findet ein Briefchen seinen Zielordner; im Menue fliegt keins hin.
        folderKey={menu ? undefined : `${account.id}|${folder.path}`}
        count={folder.unread > 0 && folder.role !== 'drafts' ? folder.unread : undefined}
        total={folder.role === 'drafts' && folder.total > 0 ? folder.total : undefined}
        current={isFolder(account.id, folder.path)}
        twisty={parent ? { open, onToggle: () => props.onToggle(key, !open) } : undefined}
        onClick={() => props.onSelect({ kind: 'folder', accountId: account.id, folder: folder.path })}
        onContextMenu={props.onFolderContextMenu && ((event) => props.onFolderContextMenu?.(event, account.id, folder))}
        labelOf={labelOf}
        drop={
          dragging
            ? {
                accountId: account.id,
                accepts: (items) => canDrop(items, account.id, folder),
                onDrop: (items) => props.onDropMail?.(items, account.id, folder)
              }
            : undefined
        }
        spring={parent ? springFor(key, account.id, open) : undefined}
      />
    )
  }

  if (scopeAccountId) {
    const account = props.accounts.find((a) => a.id === scopeAccountId)
    if (!account) return null
    const { standard, own } = splitFolders(props.foldersByAccount.get(account.id) ?? [])
    const rows = folderRows(own, (f) => props.isOpen(`folder:${account.id}|${f.path}`, true))
    return (
      <>
        {standard.map((folder) => folderButton(account, folder, 0, false))}
        {rows.length > 0 && <div className="lv-fd-sep" role="separator" />}
        {rows.map((row) => folderButton(account, row.folder, row.level, row.parent))}
      </>
    )
  }

  const counts: Record<string, { count?: number; total?: number }> = {
    inbox: { count: props.unreadTotal || undefined },
    unread: { count: props.unreadTotal || undefined },
    flagged: { total: props.viewCounts.flagged || undefined },
    snoozed: { total: props.viewCounts.snoozed || undefined },
    attachments: {}
  }

  return (
    <>
      {UNIFIED_VIEWS.map((unified) => (
        <FolderRow
          key={unified.id}
          menu={menu}
          level={0}
          icon={unified.icon}
          label={unified.label}
          {...counts[unified.id]}
          current={view.kind === 'unified' && view.id === unified.id}
          onClick={() => props.onSelect({ kind: 'unified', id: unified.id })}
          labelOf={labelOf}
          // Sammelansichten sind keine Orte, sie nehmen nie etwas an.
          drop={dragging ? { accepts: () => false } : undefined}
        />
      ))}

      {props.accounts.map((account, index) => {
        const groupKey = `account:${account.id}`
        const open = props.isOpen(groupKey, index < props.openGroups)
        const ownKey = `own:${account.id}`
        const ownOpen = props.isOpen(ownKey, false)
        const { standard, own } = splitFolders(props.foldersByAccount.get(account.id) ?? [])
        const phase = props.statusById.get(account.id)?.phase
        // Offline zählt mit: auch dann kommt von dem Konto nichts Neues.
        const failed = phase === 'error' || phase === 'offline'
        const unread = props.unreadByAccount.get(account.id) ?? 0
        const rows = ownOpen ? folderRows(own, (f) => props.isOpen(`folder:${account.id}|${f.path}`, true)) : []
        return (
          <div className="lv-fg" key={account.id} data-account-group={account.id} role={menu ? 'none' : 'group'} aria-label={menu ? undefined : account.label}>
            <GroupHead
              className="lv-fg-head"
              accountId={account.id}
              labelOf={labelOf}
              spring={springFor(groupKey, account.id, open)}
              role={menu ? 'menuitem' : undefined}
              tabIndex={menu ? -1 : undefined}
              aria-expanded={open}
              style={accountTone(account.color, props.theme)}
              onClick={() => props.onToggle(groupKey, !open)}
              onContextMenu={props.onAccountContextMenu && ((event) => props.onAccountContextMenu?.(event, account.id))}
            >
              <IconChevronRight size={14} className="lv-tw-i" />
              <span className="lv-fg-dot" aria-hidden="true" />
              <span className="lv-fi-lb">{account.label}</span>
              {failed ? (
                <span className="lv-fg-err">Fehler</span>
              ) : (
                !open && unread > 0 && <span className="lv-fi-n">{unread}</span>
              )}
            </GroupHead>
            {open && (
              <>
                {standard.map((folder) => folderButton(account, folder, 0, false))}
                {own.length > 0 && (
                  <FolderRow
                    menu={menu}
                    level={0}
                    more
                    icon={<IconFolder />}
                    label="Eigene Ordner"
                    total={own.length}
                    expanded={ownOpen}
                    onClick={() => props.onToggle(ownKey, !ownOpen)}
                    labelOf={labelOf}
                    spring={springFor(ownKey, account.id, ownOpen)}
                  />
                )}
                {rows.map((row) => folderButton(account, row.folder, row.level + 1, row.parent))}
              </>
            )}
          </div>
        )
      })}
    </>
  )
}

/** Ein Ziel fuer gezogene Mails: nimmt sie an oder lehnt sie mit einem Grund ab. */
interface DropTarget {
  /** Das Konto des Ziels, fuer den Grund einer Ablehnung; fehlt bei Sammelansichten */
  accountId?: string
  accepts: (items: MessageSummary[]) => boolean
  onDrop?: (items: MessageSummary[]) => void
}

/** Klappt auf, wenn eine gezogene Mail darueber verweilt, und merkt sich das fuers Wiederzuklappen. */
interface Spring {
  key: string
  accountId: string
  open: () => void
  close: () => void
}

interface FolderRowProps {
  menu: boolean
  level: number
  icon: ReactNode
  label: string
  title?: string
  /** `${accountId}|${path}` eines echten Ordners in der Spalte, als data-folder */
  folderKey?: string
  /** Ungelesene, betont */
  count?: number
  /** Eine leise Gesamtzahl (Entwürfe, Markiert, Eigene Ordner) */
  total?: number
  current?: boolean
  /** "Eigene Ordner": schaltet auf und zu, statt eine Ansicht zu wählen */
  more?: boolean
  expanded?: boolean
  /** Ordner mit Unterordnern: der Pfeil in der Einrückung */
  twisty?: { open: boolean; onToggle: () => void }
  onClick: () => void
  onContextMenu?: (event: React.MouseEvent) => void
  drop?: DropTarget
  spring?: Spring
  labelOf: (accountId: string) => string
}

function FolderRow(props: FolderRowProps) {
  const style = { '--lvl': props.level } as React.CSSProperties
  const drag = useMailDrag()
  const target = useDropTarget(props.drop, props.spring, props.labelOf)
  // Waehrend gezogen wird, tritt zurueck, was die Mails nicht nimmt.
  const dim = Boolean(drag && props.drop && !props.drop.accepts(drag.items))

  const button = (
    <button
      type="button"
      {...target.handlers}
      data-drop={target.state ?? undefined}
      data-dim={dim || undefined}
      data-spring={target.springing || undefined}
      data-folder={props.folderKey}
      className={props.more ? 'lv-fi lv-fi--more' : 'lv-fi'}
      role={props.menu ? 'menuitem' : undefined}
      tabIndex={props.menu ? -1 : undefined}
      style={style}
      title={props.title ?? props.label}
      aria-current={props.current ? 'page' : undefined}
      aria-expanded={props.more ? Boolean(props.expanded) : undefined}
      data-unread={props.count ? true : undefined}
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
    >
      {props.more && <IconChevronRight size={14} className="lv-tw-i" />}
      {props.icon}
      <span className="lv-fi-lb">{props.label}</span>
      {props.count ? (
        <span className="lv-fi-n">{props.count}</span>
      ) : props.total ? (
        <span className="lv-fi-n lv-fi-n--total">{props.total}</span>
      ) : null}
    </button>
  )
  if (!props.twisty) return button
  // Der Pfeil ist ein eigener Knopf neben der Zeile: ein Knopf im Knopf geht nicht.
  return (
    <div className="lv-fi-wrap" style={style}>
      {button}
      <button
        type="button"
        className="lv-tw"
        tabIndex={props.menu ? -1 : undefined}
        aria-expanded={props.twisty.open}
        aria-label={`Unterordner von ${props.label} ${props.twisty.open ? 'einklappen' : 'ausklappen'}`}
        onClick={props.twisty.onToggle}
      >
        <IconChevronRight size={14} className="lv-tw-i" />
      </button>
    </div>
  )
}

/**
 * Alles, was ein Element als Ziel gezogener Mails tut: unter dem Zeiger als
 * gueltig oder ungueltig zeigen, dem Ziehgeist den Grund einer Ablehnung
 * melden, nach dem Verweilen aufklappen und das Ablegen ausfuehren.
 */
function useDropTarget(drop: DropTarget | undefined, spring: Spring | undefined, labelOf: (id: string) => string) {
  const [state, setState] = useState<'ok' | 'no' | null>(null)
  const [springing, setSpringing] = useState(false)
  // dragenter und dragleave feuern auch an den Kindern; erst bei 0 ist der Zeiger wirklich weg.
  const depth = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const springRef = useRef(spring)
  springRef.current = spring
  /** Dieses Ziel, als Besitzer seiner Ablehnung */
  const self = useRef({}).current

  const stopSpring = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setSpringing(false)
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const reset = (): void => {
    depth.current = 0
    setState(null)
    stopSpring()
    clearRefusal(self)
  }

  // Endet das Ziehen irgendwo anders, darf hier nichts markiert stehen bleiben.
  const drag = useMailDrag()
  useEffect(() => {
    if (!drag && (state || springing)) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag])

  const handlers = {
    onDragEnter: (event: React.DragEvent) => {
      const items = draggedMail(event)
      if (!items) return
      depth.current++
      if (depth.current > 1) return
      const current = mailDragState()
      const accepts = drop ? drop.accepts(items) : undefined
      if (accepts === true) {
        setState('ok')
        clearRefusal(self)
      } else if (accepts === false) {
        setState('no')
        refuseDrop(self, current && drop?.accountId ? refusalNote(current, drop.accountId, labelOf) : undefined)
      }
      // Aufklappen nur, wo die Mails auch hinduerfen.
      const blocked = Boolean(current && spring && refusalNote(current, spring.accountId, labelOf))
      if (spring && blocked) {
        refuseDrop(self, refusalNote(current!, spring.accountId, labelOf))
        setState('no')
      } else if (spring && !timer.current) {
        setSpringing(true)
        timer.current = setTimeout(() => {
          timer.current = null
          setSpringing(false)
          const s = springRef.current
          if (!s) return
          s.open()
          noteSprung(s.key, s.accountId, s.close)
        }, HOVER_OPEN_MS)
      }
    },
    onDragOver: (event: React.DragEvent) => {
      const items = draggedMail(event)
      if (!items) return
      // Ohne preventDefault gilt die Stelle als "hier nicht ablegen" - das soll nur ein gueltiges Ziel aufheben.
      if (drop?.accepts(items)) {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }
    },
    onDragLeave: () => {
      if (!depth.current) return
      depth.current--
      if (depth.current === 0) reset()
    },
    onDrop: (event: React.DragEvent) => {
      const items = draggedMail(event)
      reset()
      if (!items || !drop?.accepts(items)) return
      event.preventDefault()
      drop.onDrop?.(items)
    }
  }

  return { state, springing, handlers }
}

/** Kopf einer Kontogruppe: tritt beim Ziehen zurueck, wenn die Mails nicht in dieses Konto duerfen. */
function GroupHead({
  spring,
  accountId,
  labelOf,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { spring?: Spring; accountId: string; labelOf: (id: string) => string }) {
  const drag = useMailDrag()
  const blocked = Boolean(drag && refusalNote(drag, accountId, labelOf))
  // Ein Kopf ist kein Ablageort: er klappt nur auf, oder er lehnt ab, wenn das Konto nicht passt.
  const target = useDropTarget(blocked ? { accountId, accepts: () => false } : undefined, blocked ? undefined : spring, labelOf)
  return (
    <button
      type="button"
      {...rest}
      {...target.handlers}
      data-dim={blocked || undefined}
      data-drop={target.state === 'no' ? 'no' : undefined}
      data-spring={target.springing || undefined}
    >
      {children}
    </button>
  )
}

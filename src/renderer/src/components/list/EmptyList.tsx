import type { ReactNode } from 'react'
import type { Folder, ViewRef } from '@shared/types'
import { folderLabel } from '../../lib/format'
import { roleIcon } from '../../lib/views'
import { IconCheck, IconClock, IconCompose, IconPaperclip, IconReset, IconSearch, IconStar } from '../icons'

interface Props {
  view: ViewRef
  searchText: string
  folder?: Folder
  onClearSearch: () => void
  onCompose: () => void
}

/** Eine knappe Notiz mitten in der leeren Liste, mit dem nächsten Schritt als Knopf, wo es einen gibt. */
export function EmptyList({ view, searchText, folder, onClearSearch, onCompose }: Props) {
  const note = describe(view, searchText, folder, onClearSearch, onCompose)
  return (
    <div className="lv-empty">
      <div className="rv-statenote">
        <div className={note.done ? 'rv-mark lv-mark--done' : 'rv-mark'}>{note.icon}</div>
        <div className="rv-statenote-body">
          <div>
            <h2>{note.title}</h2>
            <p>{note.text}</p>
          </div>
          {note.action}
        </div>
      </div>
    </div>
  )
}

interface Note {
  icon: ReactNode
  title: string
  text: string
  action?: ReactNode
  /** Der grüne Haken: nichts mehr zu tun */
  done?: boolean
}

function describe(view: ViewRef, searchText: string, folder: Folder | undefined, onClearSearch: () => void, onCompose: () => void): Note {
  if (searchText.trim()) {
    return {
      icon: <IconSearch size={20} />,
      title: 'Keine Treffer',
      text: `Für „${searchText.trim()}“ gibt es nichts, auch nicht auf dem Server.`,
      action: (
        <button type="button" className="rv-btn rv-btn--outline" onClick={onClearSearch}>
          <IconReset />
          Suche leeren
        </button>
      )
    }
  }
  if (view.kind === 'unified') {
    switch (view.id) {
      case 'unread':
        return { icon: <IconCheck size={20} />, title: 'Alles gelesen', text: 'Neue ungelesene Nachrichten erscheinen hier von selbst.', done: true }
      case 'flagged':
        return { icon: <IconStar size={20} />, title: 'Nichts markiert', text: 'Der Stern in der Leiste legt eine Nachricht hier ab.' }
      case 'snoozed':
        return { icon: <IconClock size={20} />, title: 'Nichts zurückgestellt', text: 'Zurückstellen blendet eine Nachricht aus, bis du sie brauchst.' }
      case 'attachments':
        return { icon: <IconPaperclip size={20} />, title: 'Keine Anhänge', text: 'Nachrichten mit Anhang erscheinen hier.' }
      default:
        return { icon: roleIcon('inbox'), title: 'Posteingang ist leer', text: 'Neue Nachrichten erscheinen hier von selbst.' }
    }
  }
  if (folder?.role === 'drafts') {
    return {
      icon: roleIcon('drafts'),
      title: 'Keine Entwürfe',
      text: 'Angefangene Nachrichten landen hier, bis du sie abschickst.',
      action: (
        <button type="button" className="rv-btn rv-btn--outline" onClick={onCompose}>
          <IconCompose size={16} />
          Neue Nachricht
        </button>
      )
    }
  }
  const name = folder ? folderLabel(folder.name, folder.role) : 'Dieser Ordner'
  return { icon: roleIcon(folder?.role ?? 'other'), title: `${name} ist leer`, text: 'Was hier landet, erscheint von selbst.' }
}

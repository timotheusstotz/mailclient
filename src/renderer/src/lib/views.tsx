import type { ReactNode } from 'react'
import type { Account, Folder, FolderRole, ViewRef } from '@shared/types'
import {
  IconArchive,
  IconClock,
  IconDraft,
  IconFolder,
  IconInbox,
  IconJunk,
  IconMail,
  IconPaperclip,
  IconSent,
  IconStar,
  IconTrash
} from '../components/icons'
import { folderLabel } from './format'

type UnifiedId = Extract<ViewRef, { kind: 'unified' }>['id']

/** Die Sammelansichten über alle Konten, in der Reihenfolge der Ordnerspalte. */
export const UNIFIED_VIEWS: { id: UnifiedId; label: string; icon: ReactNode }[] = [
  { id: 'inbox', label: 'Posteingang', icon: <IconInbox /> },
  { id: 'unread', label: 'Ungelesen', icon: <IconMail /> },
  { id: 'flagged', label: 'Markiert', icon: <IconStar /> },
  { id: 'snoozed', label: 'Zurückgestellt', icon: <IconClock /> },
  { id: 'attachments', label: 'Anhänge', icon: <IconPaperclip /> }
]

const ROLE_ICONS: Partial<Record<FolderRole, () => ReactNode>> = {
  inbox: () => <IconInbox />,
  sent: () => <IconSent />,
  drafts: () => <IconDraft />,
  trash: () => <IconTrash />,
  junk: () => <IconJunk />,
  archive: () => <IconArchive />
}

export function roleIcon(role: FolderRole): ReactNode {
  return (ROLE_ICONS[role] ?? (() => <IconFolder />))()
}

export interface ViewInfo {
  title: string
  icon: ReactNode
  /** Konto, dem die Ansicht gehört; leer bei Sammelansichten */
  account?: Account
  folder?: Folder
}

/** Name und Symbol der gewählten Ansicht, für die Unterzeile und das Ordnermenü. */
export function viewInfo(view: ViewRef, accountsById: Map<string, Account>, folderByKey: Map<string, Folder>): ViewInfo {
  if (view.kind === 'unified') {
    const unified = UNIFIED_VIEWS.find((u) => u.id === view.id) ?? UNIFIED_VIEWS[0]
    return { title: unified.label, icon: unified.icon }
  }
  if (view.kind === 'folder') {
    const folder = folderByKey.get(`${view.accountId}|${view.folder}`)
    return {
      title: folder ? folderLabel(folder.name, folder.role) : view.folder,
      icon: roleIcon(folder?.role ?? 'other'),
      account: accountsById.get(view.accountId),
      folder
    }
  }
  return { title: 'Suche', icon: <IconFolder /> }
}

/** "im Posteingang", "im Archiv", "in Gesendet", "in „Arbeit“" */
export function inPlace(title: string, role?: FolderRole): string {
  if (role === 'inbox' || title === 'Posteingang') return 'im Posteingang'
  if (role === 'archive') return 'im Archiv'
  if (role === 'trash') return 'im Papierkorb'
  if (role === 'junk') return 'im Spam'
  if (role === 'sent' || role === 'drafts' || !role) return `in ${title}`
  return `in „${title}“`
}

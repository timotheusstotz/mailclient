import { useState, type ReactNode } from 'react'
import type { ViewRef } from '@shared/types'
import { IconChevron } from '../icons'
import { MenuButton, useMenuClose } from '../reader/Menu'
import { FolderTree, type FolderTreeProps } from './FolderTree'

interface Props extends Omit<FolderTreeProps, 'mode'> {
  title: string
  icon: ReactNode
}

/**
 * Im schmalen Fenster gibt es keine Ordnerspalte: der Titel über der Liste
 * öffnet den Ordnerbaum als Menü. Darin sind die Kontogruppen zu, bis auf die
 * des Kontos vorn (unter "Alle Konten" die erste). Eine Wahl schließt das Menü,
 * der Fokus geht zurück an den Titel.
 */
export function FolderMenu({ title, icon, ...tree }: Props) {
  return (
    <MenuButton
      label={title}
      labelledByContent
      title="Ordner wählen"
      className="rv-btn lv-vt"
      menuLabel="Ordner"
      menuClassName="rv-menu lv-menu-folders"
      menu={() => <FolderMenuBody {...tree} />}
    >
      {icon}
      {title}
      <IconChevron size={14} className="rv-chev" />
    </MenuButton>
  )
}

function FolderMenuBody(tree: Omit<FolderTreeProps, 'mode'>) {
  const close = useMenuClose()
  const front =
    tree.view.kind === 'folder' ? tree.view.accountId : (tree.scopeAccountId ?? tree.accounts[0]?.id)
  // Was im Menü auf- und zugeklappt wird, gilt nur hier; die Spalte behält ihren Stand.
  const [local, setLocal] = useState<Map<string, boolean>>(() => new Map())
  return (
    <div className="rv-menu-scroll lv-menu-folders-scroll">
      <FolderTree
        {...tree}
        mode="menu"
        isOpen={(key, fallback) =>
          local.get(key) ?? (key.startsWith('account:') ? key === `account:${front}` : tree.isOpen(key, fallback))
        }
        onToggle={(key, open) => setLocal((m) => new Map(m).set(key, open))}
        onSelect={(view: ViewRef) => {
          close()
          tree.onSelect(view)
        }}
      />
    </div>
  )
}

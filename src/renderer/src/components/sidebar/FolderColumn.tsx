import { counted } from '../../lib/format'
import { FolderTree, type FolderTreeProps } from './FolderTree'

/** Die Ordnerspalte: oben, wessen Ordner es sind, darunter der Baum, der für sich scrollt. */
export function FolderColumn(props: Omit<FolderTreeProps, 'mode'>) {
  const account = props.scopeAccountId ? props.accounts.find((a) => a.id === props.scopeAccountId) : undefined
  return (
    <aside className="lv-fd" aria-label="Ordner">
      <div className="lv-fd-head" onContextMenu={(event) => account && props.onAccountContextMenu?.(event, account.id)}>
        <b>{account ? account.label : 'Alle Konten'}</b>
        <span>{account ? account.email : `${counted(props.accounts.length, 'Konto', 'Konten')} verbunden`}</span>
      </div>
      <div className="lv-fd-scroll">
        <FolderTree {...props} mode="column" />
      </div>
    </aside>
  )
}

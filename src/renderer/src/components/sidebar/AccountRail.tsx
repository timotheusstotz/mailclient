import type { Account, AccountStatus, ViewRef } from '@shared/types'
import { accountTone, type Theme } from '../../lib/accountTone'
import { initials } from '../../lib/format'
import { IconCompose, IconLayers, IconPlus, IconSettings } from '../icons'

interface Props {
  accounts: Account[]
  statusById: Map<string, AccountStatus>
  unreadByAccount: Map<string, number>
  unreadTotal: number
  view: ViewRef
  theme: Theme
  onSelectUnified: () => void
  onSelectAccount: (accountId: string) => void
  onAccountContextMenu: (event: React.MouseEvent, accountId: string) => void
  onUnifiedContextMenu: (event: React.MouseEvent) => void
  onCompose: () => void
  onAddAccount: () => void
  onSettings: () => void
}

/**
 * Die Kontenschiene: oben "Neue Nachricht", darunter "Alle Konten" und je Konto
 * eine Kachel mit seinen Initialen in seiner Farbe. Dieselbe Farbe markiert
 * seine Mails in den Sammelansichten. Ein Klick wechselt den Kontext der
 * ganzen Oberfläche; unten "Konto hinzufügen" und die Einstellungen.
 */
export function AccountRail(props: Props) {
  const { view } = props
  const activeAccountId =
    view.kind === 'folder' ? view.accountId : view.kind === 'search' ? view.query.accountId : undefined

  return (
    <nav className="lv-rail" aria-label="Konten">
      <button type="button" className="lv-compose" aria-label="Neue Nachricht" title="Neue Nachricht (Strg+N)" onClick={props.onCompose}>
        <IconCompose size={16} />
      </button>
      <div className="lv-rail-sep" />

      <button
        type="button"
        className="lv-tile"
        aria-pressed={view.kind === 'unified'}
        aria-label="Alle Konten"
        title={props.unreadTotal ? `Alle Konten · ${props.unreadTotal} ungelesen` : 'Alle Konten'}
        onClick={props.onSelectUnified}
        onContextMenu={props.onUnifiedContextMenu}
      >
        <IconLayers size={16} />
        <Badge count={props.unreadTotal} />
      </button>

      {props.accounts.map((account) => {
        const status = props.statusById.get(account.id)
        const state = status?.phase === 'connecting' ? 'busy' : status?.phase === 'offline' ? 'off' : status?.phase === 'error' ? 'err' : undefined
        const note = state === 'off' ? 'offline' : state === 'err' ? (status?.message ?? 'Fehler') : state === 'busy' ? 'verbindet …' : ''
        return (
          <button
            key={account.id}
            type="button"
            className="lv-tile"
            data-state={state}
            aria-pressed={activeAccountId === account.id}
            aria-label={`${account.label} · ${account.email}`}
            title={[account.label, account.email, note].filter(Boolean).join(' · ')}
            style={accountTone(account.color, props.theme)}
            onClick={() => props.onSelectAccount(account.id)}
            onContextMenu={(event) => props.onAccountContextMenu(event, account.id)}
          >
            <span className="lv-ini" aria-hidden="true">
              {initials(account.label || account.email)}
            </span>
            <Badge count={props.unreadByAccount.get(account.id) ?? 0} />
            {state && (
              <span className={`lv-stat lv-stat--${state}`} aria-hidden="true">
                {state === 'err' ? '!' : null}
              </span>
            )}
          </button>
        )
      })}

      <button type="button" className="lv-tile lv-add" aria-label="Konto hinzufügen" title="Konto hinzufügen" onClick={props.onAddAccount}>
        <IconPlus size={16} />
      </button>
      <div className="lv-grow" />
      <button type="button" className="lv-tile" aria-label="Einstellungen" title="Einstellungen (Strg+,)" onClick={props.onSettings}>
        <IconSettings size={16} />
      </button>
    </nav>
  )
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="lv-badge" aria-hidden="true">
      {count > 99 ? '99+' : count}
    </span>
  )
}

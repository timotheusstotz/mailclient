import type { Account, Folder, MessageSummary } from '@shared/types'
import { accountTone, type Theme } from '../../lib/accountTone'
import { folderLabel, listPartner } from '../../lib/format'
import { inPlace } from '../../lib/views'
import { IconEnvelopeOpen } from '../icons'
import { ActionBar } from '../reader/ActionBar'

interface Props {
  /** Die angehakten Zeilen, in Listenreihenfolge */
  heads: MessageSummary[]
  /** Alle Mails darunter; auf sie wirken die Knöpfe */
  members: MessageSummary[]
  /** Zeilen in der Liste, für "Strg A alle 16" */
  total: number
  accountsById: Map<string, Account>
  folderByKey: Map<string, Folder>
  foldersByAccount: Map<string, Folder[]>
  theme: Theme
  onMarkRead: () => void
  onMarkUnread: () => void
  onToggleFlag: (flag: boolean) => void
  onSnooze: (until: number) => void
  onAskSnooze: () => void
  onMove: (path: string) => void
  onArchive: () => void
  onDelete: () => void
}

/**
 * Was der Lesebereich zeigt, solange mehrere Mails angehakt sind: dieselbe
 * Leiste wie über einer Mail, damit jeder Knopf an seinem Platz bleibt, und
 * darunter ein Stapel der Auswahl. Der Körper wiederholt keine Knöpfe.
 */
export function SelectionPane(props: Props) {
  const { heads, members } = props
  const accountIds = [...new Set(members.map((m) => m.accountId))]
  const accounts = accountIds.map((id) => props.accountsById.get(id)).filter((a): a is Account => Boolean(a))
  const oneAccount = accountIds.length === 1 ? props.accountsById.get(accountIds[0]) : undefined
  const folderKeys = [...new Set(members.map((m) => `${m.accountId}|${m.folder}`))]
  const commonFolder = folderKeys.length === 1 ? props.folderByKey.get(folderKeys[0]) : undefined
  const flagged = members.every((m) => m.flags.includes('\\Flagged'))

  const names = new Intl.ListFormat('de', { type: 'conjunction' }).format(accounts.map((a) => a.label))
  // Nach Namen, nicht nach Pfad: die Posteingänge zweier Konten sind ein Ort.
  const places = new Map<string, Folder['role'] | undefined>()
  for (const m of members) {
    const f = props.folderByKey.get(`${m.accountId}|${m.folder}`)
    places.set(f ? folderLabel(f.name, f.role) : m.folder, f?.role)
  }
  const [place] = places
  const where = places.size === 1 ? `alle ${inPlace(place[0], place[1])}` : `aus ${places.size} Ordnern`

  return (
    <section className="reader" aria-label="Auswahl">
      <ActionBar
        label="Aktionen für die Auswahl"
        lead={
          <button type="button" className="rv-btn" onClick={props.onMarkRead}>
            <IconEnvelopeOpen />
            Als gelesen markieren
          </button>
        }
        flagged={flagged}
        account={oneAccount}
        folder={commonFolder}
        folders={oneAccount ? (props.foldersByAccount.get(oneAccount.id) ?? []) : []}
        moveBlocked={oneAccount ? undefined : 'Verschieben geht nur, wenn alle ausgewählten Mails im selben Konto liegen'}
        onToggleFlag={() => props.onToggleFlag(!flagged)}
        onMarkUnread={props.onMarkUnread}
        onSnooze={props.onSnooze}
        onAskSnooze={props.onAskSnooze}
        onMove={props.onMove}
        onArchive={props.onArchive}
        onDelete={props.onDelete}
      />
      <div className="lv-bk">
        <div className="lv-bk-inner">
          <div className="lv-stack" aria-hidden="true">
            {heads
              .slice(0, 3)
              .reverse()
              .map((m) => {
                const account = props.accountsById.get(m.accountId)
                const folder = props.folderByKey.get(`${m.accountId}|${m.folder}`)
                return (
                  <div className="lv-sc" key={m.id} style={account ? accountTone(account.color, props.theme) : undefined}>
                    <span className="lv-sc-acc" />
                    <span className="lv-sc-t">
                      <b>{m.subject || '(kein Betreff)'}</b>
                      <span>{listPartner(m, folder?.role)}</span>
                    </span>
                  </div>
                )
              })}
          </div>
          <div>
            <h2>{heads.length} Nachrichten ausgewählt</h2>
            <p>
              Aus {names}, {where}
            </p>
          </div>
          <div className="lv-bk-keys">
            <span>
              <kbd className="rv-kbd">Strg</kbd>
              <kbd className="rv-kbd">A</kbd>
              <span>alle {props.total}</span>
            </span>
            <span>
              <kbd className="rv-kbd">Esc</kbd>
              <span>Auswahl aufheben</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

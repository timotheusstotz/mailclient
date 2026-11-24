import { useMemo } from 'react'
import type { Account, Folder, MessageBody, MessageSummary } from '@shared/types'
import type { ZoomStep } from '../lib/zoom'
import { IconCompose, IconMail } from './icons'
import { ActionBar, ReplyActions } from './reader/ActionBar'
import { Envelope } from './reader/Envelope'
import { DraftNotice } from './reader/Notices'
import { ThreadStrip } from './reader/ThreadStrip'

interface Props {
  message: MessageSummary | null
  body: MessageBody | null
  error: string | null
  onRetry: () => void
  account?: Account
  /** Ordner, in dem die Mail liegt */
  folder?: Folder
  /** Alle Ordner ihres Kontos, fuer "Verschieben" */
  folders: Folder[]
  loadRemoteByDefault: boolean
  /** Absenderdomains, deren Bilder ohne Nachfrage geladen werden. */
  trustedDomains: string[]
  /** Vergroesserung der Mail; 1 = Normalgroesse. */
  zoom: number
  onZoomStep: (step: ZoomStep) => void
  onReply: () => void
  /** Gesetzt bei einem Entwurf: statt Antworten gibt es Weiterschreiben. */
  onContinueDraft?: () => void
  onReplyAll: () => void
  onForward: () => void
  onArchive: () => void
  onDelete: () => void
  onToggleFlag: () => void
  onMarkUnread: () => void
  onMove: (path: string) => void
  onTrustDomain: (domain: string) => void
  onSaveAllAttachments: () => void
  /** Die Unterhaltung der Nachricht, aelteste zuerst; leer oder einzeln, wenn es keine gibt */
  thread: MessageSummary[]
  /** Ordner einer Mail aus der Unterhaltung als Etikett, null fuer den Posteingang */
  threadFolderTag: (message: MessageSummary) => string | null
  onOpenThreadMessage: (message: MessageSummary) => void
  /** Zurueckstellen bis zu einem Zeitpunkt in ms */
  onSnooze: (until: number) => void
  /** Nach einem freien Zeitpunkt fragen */
  onAskSnooze: () => void
  onUnsnooze: () => void
}

/**
 * Der Lesebereich: oben die Leiste, darunter in einem Bereich, der scrollt,
 * die Unterhaltung und der Umschlag der Mail (reader/Envelope). Vergroessert
 * wird nur der Umschlag, nicht die Leiste und nicht die Unterhaltung.
 */
export function Reader(props: Props) {
  const { message } = props
  if (!message) return <EmptyReader />
  return <MessageReader {...props} message={message} />
}

function EmptyReader() {
  return (
    <section className="reader" aria-label="Nachricht">
      <div className="rv-empty">
        <div className="rv-statenote">
          <div className="rv-mark">
            <IconMail size={20} />
          </div>
          <div>
            <h2>Keine Nachricht ausgewählt</h2>
            <p>
              Wähle links eine aus oder blättere mit <kbd className="rv-kbd">J</kbd> <kbd className="rv-kbd">K</kbd>
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function MessageReader(props: Props & { message: MessageSummary }) {
  const { message } = props
  const ownAddress = props.account?.email.toLowerCase()
  const canReplyAll = useMemo(() => {
    const sender = message.from[0]?.address.toLowerCase()
    return [...message.to, ...message.cc].some((a) => {
      const address = a.address.toLowerCase()
      return address !== ownAddress && address !== sender
    })
  }, [message, ownAddress])

  return (
    <section className="reader" aria-label="Nachricht">
      <ActionBar
        lead={
          props.onContinueDraft ? (
            <button
              type="button"
              className="rv-btn rv-btn--primary"
              title="Weiterschreiben · Doppelklick auf die Zeile"
              onClick={props.onContinueDraft}
            >
              <IconCompose size={16} />
              Weiterschreiben
            </button>
          ) : (
            <ReplyActions
              canReplyAll={canReplyAll}
              onReply={props.onReply}
              onReplyAll={props.onReplyAll}
              onForward={props.onForward}
            />
          )
        }
        flagged={message.flags.includes('\Flagged')}
        account={props.account}
        folder={props.folder}
        folders={props.folders}
        onToggleFlag={props.onToggleFlag}
        onMarkUnread={props.onMarkUnread}
        onSnooze={props.onSnooze}
        onAskSnooze={props.onAskSnooze}
        onMove={props.onMove}
        onArchive={props.onArchive}
        onDelete={props.onDelete}
        draft={Boolean(props.onContinueDraft)}
      />

      <Envelope
        className="rv-scroll"
        before={
          props.thread.length > 1 && (
            <ThreadStrip
              thread={props.thread}
              currentId={message.id}
              folderTag={props.threadFolderTag}
              onOpen={props.onOpenThreadMessage}
            />
          )
        }
        message={message}
        body={props.body}
        error={props.error}
        onRetry={props.onRetry}
        ownAddress={props.account?.email}
        loadRemoteByDefault={props.loadRemoteByDefault}
        trustedDomains={props.trustedDomains}
        zoom={props.zoom}
        onZoomStep={props.onZoomStep}
        onTrustDomain={props.onTrustDomain}
        onSaveAllAttachments={props.onSaveAllAttachments}
        onUnsnooze={props.onUnsnooze}
        notice={props.onContinueDraft && <DraftNotice savedAt={message.date} />}
      />
    </section>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Account, Folder, MessageBody, MessageSummary } from '@shared/types'
import { isTrustedDomain, senderDomain } from '../lib/remote-images'
import { sanitizeMailHtml, textToReadingHtml, wrapMailDocument } from '../lib/sanitize'
import type { ZoomStep } from '../lib/zoom'
import { IconMail } from './icons'
import { ActionBar, ReplyActions } from './reader/ActionBar'
import { Attachments } from './reader/Attachments'
import { MessageHead } from './reader/MessageHead'
import { RemoteNotice, SnoozeNotice } from './reader/Notices'
import { Sheet, useSkeleton, type SheetContent, type SheetPhase } from './reader/Sheet'
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
 * die Unterhaltung und der Umschlag der Mail - Kopf, Hinweise, Anhaenge und das
 * weisse Blatt in einem Rahmen.
 *
 * Vergroessert wird der ganze Umschlag wie ein Blatt Papier, nicht die Leiste
 * und nicht die Unterhaltung. Die Mail im Rahmen vergroessert MailFrame selbst;
 * was dabei nicht mehr aufs Blatt passt, macht den Umschlag breiter, und der
 * Lesebereich scrollt seitlich.
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
  const { message, body, error, zoom } = props
  const domain = senderDomain(message.from[0]?.address)
  const allowedUpfront = props.loadRemoteByDefault || isTrustedDomain(props.trustedDomains, domain)
  const [allowRemote, setAllowRemote] = useState(allowedUpfront)
  // Jede Nachricht entscheidet neu, ob externe Bilder geladen werden - es sei
  // denn, ihre Absenderdomain steht auf der Liste.
  useEffect(() => setAllowRemote(allowedUpfront), [message.id, allowedUpfront])

  const ready = body !== null && body.id === message.id
  const skeleton = useSkeleton(!ready && !error)
  const phase: SheetPhase = skeleton ? 'skeleton' : ready ? 'ready' : error ? 'error' : 'wait'

  const prepared = useMemo((): { content: SheetContent | null; blockedRemote: number } => {
    if (!body) return { content: null, blockedRemote: 0 }
    if (body.html) {
      const { html, blockedRemote } = sanitizeMailHtml(body.html, body.inlineImages, allowRemote)
      return { content: { kind: 'html', doc: wrapMailDocument(html) }, blockedRemote }
    }
    if (body.text?.trim()) return { content: { kind: 'plain', html: textToReadingHtml(body.text) }, blockedRemote: 0 }
    return { content: null, blockedRemote: 0 }
  }, [body, allowRemote])

  /*
    `sheetWidth` ist die Breite des Blatts in Normalgroesse: die Innenbreite des
    Scrollbereichs ohne den Rand des Umschlags. `contentWidth` ist die der
    vergroesserten Mail, sobald sie breiter wird.
  */
  const scrollRef = useRef<HTMLDivElement>(null)
  const [sheetWidth, setSheetWidth] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const read = (): void => {
      const style = getComputedStyle(node)
      const inner = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      setSheetWidth(Math.max(0, Math.floor(inner - ENVELOPE_BORDERS)))
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(() => setContentWidth(0), [message.id])

  const ownAddress = props.account?.email.toLowerCase()
  const canReplyAll = useMemo(() => {
    const sender = message.from[0]?.address.toLowerCase()
    return [...message.to, ...message.cc].some((a) => {
      const address = a.address.toLowerCase()
      return address !== ownAddress && address !== sender
    })
  }, [message, ownAddress])

  const snoozed = message.snoozedUntil !== undefined && !message.snoozeOver
  const widened = contentWidth > sheetWidth

  return (
    <section className="reader" aria-label="Nachricht">
      <ActionBar
        lead={
          <ReplyActions
            canReplyAll={canReplyAll}
            onReply={props.onReply}
            onReplyAll={props.onReplyAll}
            onForward={props.onForward}
          />
        }
        flagged={message.flags.includes('\\Flagged')}
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
      />

      <div className="rv-scroll" ref={scrollRef}>
        {props.thread.length > 1 && (
          <ThreadStrip
            thread={props.thread}
            currentId={message.id}
            folderTag={props.threadFolderTag}
            onOpen={props.onOpenThreadMessage}
          />
        )}

        {/* Der Rahmen bleibt beim Wechsel innerhalb der Unterhaltung stehen; nur sein Inhalt wechselt. */}
        <article
          className="rv-env"
          data-zoomed={zoom !== 1 || undefined}
          style={widened ? { width: contentWidth + ENVELOPE_BORDERS } : undefined}
        >
          <div className="rv-env-top" key={`top-${message.id}`} style={{ zoom }}>
            <MessageHead message={message} ownAddress={props.account?.email} />
            {snoozed && <SnoozeNotice until={message.snoozedUntil!} onUnsnooze={props.onUnsnooze} />}
            {phase === 'ready' && prepared.blockedRemote > 0 && (
              <RemoteNotice
                count={prepared.blockedRemote}
                domain={domain}
                onAllow={() => setAllowRemote(true)}
                onTrust={() => {
                  setAllowRemote(true)
                  props.onTrustDomain(domain)
                }}
              />
            )}
            {phase === 'ready' && body && body.attachments.length > 0 && (
              <Attachments message={message} body={body} onSaveAll={props.onSaveAllAttachments} />
            )}
          </div>
          <Sheet
            key={`sheet-${message.id}`}
            phase={phase}
            content={prepared.content}
            zoom={zoom}
            sheetWidth={sheetWidth}
            onContentWidth={setContentWidth}
            onZoomStep={props.onZoomStep}
            onRetry={props.onRetry}
          />
        </article>
      </div>
    </section>
  )
}

/** Links und rechts je 1 px Rand um den Umschlag. */
const ENVELOPE_BORDERS = 2

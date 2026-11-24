import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { MessageBody, MessageSummary } from '@shared/types'
import { isTrustedDomain, senderDomain } from '../../lib/remote-images'
import { sanitizeMailHtml, textToReadingHtml, wrapMailDocument } from '../../lib/sanitize'
import type { ZoomStep } from '../../lib/zoom'
import { Attachments } from './Attachments'
import { MessageHead } from './MessageHead'
import { RemoteNotice, SnoozeNotice } from './Notices'
import { Sheet, useSkeleton, type SheetContent, type SheetPhase } from './Sheet'

export interface EnvelopeProps {
  message: MessageSummary
  body: MessageBody | null
  error: string | null
  onRetry: () => void
  /** Die eigene Adresse, falls die Mail kein "An" hat */
  ownAddress?: string
  loadRemoteByDefault: boolean
  /** Absenderdomains, deren Bilder ohne Nachfrage geladen werden. */
  trustedDomains: string[]
  /** Vergroesserung der Mail; 1 = Normalgroesse. */
  zoom: number
  onZoomStep: (step: ZoomStep) => void
  onTrustDomain: (domain: string) => void
  onSaveAllAttachments: () => void
  /** Zurueckgestellt: der Weg zurueck; ohne gibt es den Hinweis nicht */
  onUnsnooze?: () => void
  /** Hinweise unter dem Kopf, etwa "Entwurf, noch nicht gesendet" */
  notice?: ReactNode
}

/**
 * Der Umschlag einer Mail in seinem Scrollbereich: Kopf, Hinweise, Anhaenge
 * und das weisse Blatt in einem Rahmen. Der Lesebereich und das Mail-Fenster
 * zeigen ihn gleich; davor kann etwas stehen (die Unterhaltung).
 *
 * Vergroessert wird der ganze Umschlag wie ein Blatt Papier. Die Mail im
 * Rahmen vergroessert MailFrame selbst; was dabei nicht mehr aufs Blatt
 * passt, macht den Umschlag breiter, und der Bereich scrollt seitlich.
 */
export function Envelope({ className, before, ...props }: EnvelopeProps & { className: string; before?: ReactNode }) {
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

  const snoozed = message.snoozedUntil !== undefined && !message.snoozeOver
  const widened = contentWidth > sheetWidth

  return (
    <div className={className} ref={scrollRef}>
      {before}
      {/* Der Rahmen bleibt beim Wechsel innerhalb der Unterhaltung stehen; nur sein Inhalt wechselt. */}
      <article
        className="rv-env"
        data-zoomed={zoom !== 1 || undefined}
        style={widened ? { width: contentWidth + ENVELOPE_BORDERS } : undefined}
      >
        <div className="rv-env-top" key={`top-${message.id}`} style={{ zoom }}>
          <MessageHead message={message} ownAddress={props.ownAddress} />
          {props.notice}
          {snoozed && props.onUnsnooze && <SnoozeNotice until={message.snoozedUntil!} onUnsnooze={props.onUnsnooze} />}
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
  )
}

/** Links und rechts je 1 px Rand um den Umschlag. */
const ENVELOPE_BORDERS = 2

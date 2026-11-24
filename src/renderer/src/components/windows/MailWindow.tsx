import { useEffect, useRef } from 'react'
import type { MessageBody, MessageSummary } from '@shared/types'
import { useMessageBody } from '../../state'
import type { ZoomStep } from '../../lib/zoom'
import { IconForward, IconMail, IconReply, IconTrash } from '../icons'
import { Envelope } from '../reader/Envelope'
import { useWindowMotion } from './motion'
import { WindowControls } from './WindowControls'

interface Props {
  windowId: string
  message: MessageSummary
  expanded: boolean
  leaving: boolean
  /** Die eigene Adresse, falls die Mail kein "An" hat */
  ownAddress?: string
  loadRemoteByDefault: boolean
  trustedDomains: string[]
  zoom: number
  onZoomStep: (step: ZoomStep) => void
  onTrustDomain: (domain: string) => void
  onSaveAllAttachments: () => void
  onMinimize: () => void
  onClose: () => void
  /** Mit dem geladenen Text, damit die Antwort diese Mail zitiert und nicht die im Lesebereich */
  onReply: (body: MessageBody | null) => void
  onForward: (body: MessageBody | null) => void
  onDelete: () => void
}

/**
 * Eine Mail in ihrem eigenen Fenster (Doppelklick auf die Zeile): derselbe
 * Rahmen wie Verfassen, darin der Umschlag wie im Lesebereich, nur lesend.
 * Die Kuerzel sind die des Lesebereichs: R, F, Entf, dazu Esc.
 */
export function MailWindow(props: Props) {
  const { message, expanded } = props
  const sectionRef = useRef<HTMLElement>(null)
  const hidden = useWindowMotion(sectionRef, props.windowId, expanded, props.leaving)
  const { body, error, retry } = useMessageBody(message)
  const loaded = body && body.id === message.id ? body : null

  // Aufgeklappt und sichtbar: der Fokus kommt ins Fenster, sonst landen Esc und R in der Leiste.
  const shown = expanded && !hidden
  useEffect(() => {
    if (shown) sectionRef.current?.focus()
  }, [shown])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    const keys: Record<string, () => void> = {
      Escape: props.onClose,
      r: () => props.onReply(loaded),
      f: () => props.onForward(loaded),
      Delete: props.onDelete
    }
    const run = keys[event.key]
    if (!run) return
    event.preventDefault()
    run()
  }

  const subject = message.subject || '(kein Betreff)'
  return (
    <section
      ref={sectionRef}
      className="cw mail-window"
      role="dialog"
      aria-modal="false"
      aria-label={subject}
      tabIndex={-1}
      hidden={hidden}
      onKeyDown={onKeyDown}
    >
      <header className="cw-head">
        <span className="cw-kind" aria-hidden="true">
          <IconMail size={15} />
        </span>
        <button type="button" className="rv-btn rv-btn--primary" title="Antworten (R)" onClick={() => props.onReply(loaded)}>
          <IconReply />
          Antworten
        </button>
        <button type="button" className="rv-btn" title="Weiterleiten (F)" onClick={() => props.onForward(loaded)}>
          <IconForward />
          Weiterleiten
        </button>
        <div className="rv-seg">
          <button
            type="button"
            className="rv-btn rv-btn--icon rv-btn--danger"
            aria-label="In den Papierkorb"
            title="In den Papierkorb (Entf)"
            onClick={props.onDelete}
          >
            <IconTrash />
          </button>
        </div>
        <div className="cw-grow" />
        <span className="cw-sep" aria-hidden="true" />
        <WindowControls closeTitle="Schließen (Esc)" onMinimize={props.onMinimize} onClose={props.onClose} />
      </header>
      <Envelope
        className="rv-scroll cw-body"
        message={message}
        body={body}
        error={error}
        onRetry={retry}
        ownAddress={props.ownAddress}
        loadRemoteByDefault={props.loadRemoteByDefault}
        trustedDomains={props.trustedDomains}
        zoom={props.zoom}
        onZoomStep={props.onZoomStep}
        onTrustDomain={props.onTrustDomain}
        onSaveAllAttachments={props.onSaveAllAttachments}
      />
    </section>
  )
}

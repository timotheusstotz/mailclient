import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Account, Folder, MessageBody, MessageSummary } from '@shared/types'
import { timePresets } from '@shared/times'
import { addressList, fileSize, folderLabel, fullDate, shortDate, shortDateTime } from '../lib/format'
import { isTrustedDomain, senderDomain } from '../lib/remote-images'
import { sanitizeMailHtml, textToHtml, wrapMailDocument } from '../lib/sanitize'
import { attachCtrlWatch, attachZoomKeys, type ZoomStep } from '../lib/zoom'
import {
  IconArchive,
  IconDownload,
  IconEnvelopeOpen,
  IconForward,
  IconPaperclip,
  IconReply,
  IconReplyAll,
  IconStar,
  IconStarFilled,
  IconTrash
} from './icons'

interface Props {
  message: MessageSummary | null
  body: MessageBody | null
  loading: boolean
  error: string | null
  account?: Account
  folder?: Folder
  moveTargets: Folder[]
  loadRemoteByDefault: boolean
  /** Absenderdomains, deren Bilder ohne Nachfrage geladen werden. */
  trustedDomains: string[]
  /** Vergroesserung des Nachrichteninhalts; 1 = Normalgroesse. */
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
  /** Die Unterhaltung der Nachricht, aelteste zuerst; leer oder einzeln, wenn es keine gibt */
  thread: MessageSummary[]
  /** Ordnername einer Nachricht aus der Unterhaltung, fuer die Anzeige */
  threadFolderLabel: (message: MessageSummary) => string
  onOpenThreadMessage: (message: MessageSummary) => void
  /** Zurueckstellen bis zu einem Zeitpunkt in ms */
  onSnooze: (until: number) => void
  /** Nach einem freien Zeitpunkt fragen */
  onAskSnooze: () => void
  onUnsnooze: () => void
}

export function Reader(props: Props) {
  const { message, body, loading, error } = props
  const domain = senderDomain(message?.from[0]?.address)
  const trusted = isTrustedDomain(props.trustedDomains, domain)
  const allowedUpfront = props.loadRemoteByDefault || trusted
  const [allowRemote, setAllowRemote] = useState(allowedUpfront)

  const scrollRef = useRef<HTMLDivElement>(null)

  /*
    Vergroessert wird die ganze Mail wie ein Blatt Papier: Kopf, Hinweise und
    Inhalt im selben Massstab, und das Blatt waechst mit, statt dass der Inhalt
    darueber hinausragt. `sheetWidth` ist die Breite des Blatts in Normalgroesse,
    `contentWidth` die der vergroesserten Mail, sobald sie breiter wird.
  */
  const [sheetWidth, setSheetWidth] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const read = (): void => {
      const style = getComputedStyle(node)
      const inner = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      setSheetWidth(Math.max(0, Math.min(860, Math.floor(inner))))
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(node)
    return () => observer.disconnect()
  }, [message?.id])
  useEffect(() => setContentWidth(0), [message?.id])

  // Jede Nachricht entscheidet neu, ob externe Bilder geladen werden - es sei
  // denn, ihre Absenderdomain steht auf der Liste.
  useEffect(() => setAllowRemote(allowedUpfront), [message?.id, allowedUpfront])

  const onZoomStep = props.onZoomStep

  if (!message) {
    return (
      <section className="reader">
        <div className="empty">
          <div className="empty-inner">
            <h2>Keine Nachricht ausgewaehlt</h2>
            <p>Waehle links eine Nachricht aus, oder schreibe mit Strg+N eine neue.</p>
          </div>
        </div>
      </section>
    )
  }

  const flagged = message.flags.includes('\\Flagged')
  const snoozed = message.snoozedUntil !== undefined && !message.snoozeOver

  return (
    <section className="reader" aria-label="Nachricht">
      <div className="reader-bar">
        <button className="btn" onClick={props.onReply}>
          <IconReply size={15} /> Antworten
        </button>
        {message.to.length + message.cc.length > 1 && (
          <button className="btn" onClick={props.onReplyAll}>
            <IconReplyAll size={15} /> Allen antworten
          </button>
        )}
        <button className="btn" onClick={props.onForward}>
          <IconForward size={15} /> Weiterleiten
        </button>

        <div className="spacer" />

        <button
          className="btn btn-icon"
          onClick={props.onToggleFlag}
          title={flagged ? 'Markierung entfernen' : 'Markieren'}
          aria-label={flagged ? 'Markierung entfernen' : 'Markieren'}
        >
          {flagged ? <IconStarFilled size={15} className="flagged" /> : <IconStar size={15} />}
        </button>
        <button
          className="btn btn-icon"
          onClick={props.onMarkUnread}
          title="Als ungelesen markieren"
          aria-label="Als ungelesen markieren"
        >
          <IconEnvelopeOpen size={15} />
        </button>
        <select
          className="btn"
          value=""
          onChange={(e) => {
            const value = e.target.value
            e.target.value = ''
            if (value === 'custom') props.onAskSnooze()
            else if (value) props.onSnooze(Number(value))
          }}
          aria-label="Zurueckstellen"
          title="Ausblenden, bis die Nachricht wieder gebraucht wird (B)"
        >
          <option value="">Zurueckstellen</option>
          {timePresets().map((preset) => (
            <option key={preset.id} value={preset.at}>
              {preset.label}
            </option>
          ))}
          <option value="custom">Zeitpunkt waehlen &hellip;</option>
        </select>
        {props.moveTargets.length > 0 && (
          <select
            className="btn"
            value=""
            onChange={(e) => {
              if (e.target.value) props.onMove(e.target.value)
              e.target.value = ''
            }}
            aria-label="In Ordner verschieben"
            title="In Ordner verschieben"
          >
            <option value="">Verschieben</option>
            {props.moveTargets.map((f) => (
              <option key={f.path} value={f.path}>
                {folderLabel(f.name, f.role)}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-icon" onClick={props.onArchive} title="Archivieren" aria-label="Archivieren">
          <IconArchive size={15} />
        </button>
        <button
          className="btn btn-icon btn-danger"
          onClick={props.onDelete}
          title="In den Papierkorb"
          aria-label="In den Papierkorb"
        >
          <IconTrash size={15} />
        </button>
      </div>

      <div className="reader-scroll" ref={scrollRef}>
       <div
        className="reader-stack"
        style={contentWidth > sheetWidth ? { width: contentWidth, maxWidth: 'none' } : undefined}
       >
        {props.thread.length > 1 && (
          <nav className="thread" aria-label="Unterhaltung">
            <div className="thread-head">Unterhaltung &middot; {props.thread.length} Nachrichten</div>
            <div className="thread-items">
              {props.thread.map((item) => (
                <button
                  key={item.id}
                  className="thread-item"
                  aria-current={item.id === message.id}
                  data-unread={!item.flags.includes('\\Seen')}
                  onClick={() => props.onOpenThreadMessage(item)}
                >
                  <span className="who">{item.from[0]?.name || item.from[0]?.address || 'Unbekannt'}</span>
                  <span className="what">{item.snippet || item.subject}</span>
                  <span className="where">{props.threadFolderLabel(item)}</span>
                  <span className="when">{shortDate(item.date)}</span>
                </button>
              ))}
            </div>
          </nav>
        )}
        <article className="sheet" key={message.id} data-zoomed={props.zoom > 1}>
          <header className="sheet-head" style={{ zoom: props.zoom }}>
            <h1 className="sheet-subject">{message.subject}</h1>
            <div className="sheet-from">
              <span className="name">{message.from[0]?.name || message.from[0]?.address || 'Unbekannt'}</span>
              {message.from[0]?.name && <span className="addr">{message.from[0].address}</span>}
              <span className="sheet-date" title={fullDate(message.date)}>
                {fullDate(message.date)}
              </span>
            </div>
            <div className="sheet-meta">
              An {addressList(message.to, 4) || props.account?.email || 'unbekannt'}
              {message.cc.length > 0 && <> &nbsp;&middot;&nbsp; Kopie an {addressList(message.cc, 3)}</>}
            </div>
          </header>

          {snoozed && (
            <p className="snooze-notice" style={{ zoom: props.zoom }}>
              <span>Zurueckgestellt bis {shortDateTime(message.snoozedUntil!)}.</span>
              <button className="link-btn" onClick={props.onUnsnooze}>
                Jetzt zurueckholen
              </button>
            </p>
          )}

          {body && body.attachments.length > 0 && (
            <div style={{ zoom: props.zoom }}>
              <AttachmentBar message={message} body={body} />
            </div>
          )}

          <MailContent
            body={body}
            loading={loading}
            error={error}
            allowRemote={allowRemote}
            domain={domain}
            zoom={props.zoom}
            sheetWidth={sheetWidth}
            onContentWidth={setContentWidth}
            onZoomStep={onZoomStep}
            onAllowRemote={() => setAllowRemote(true)}
            onTrustDomain={() => {
              setAllowRemote(true)
              props.onTrustDomain(domain)
            }}
          />
        </article>
       </div>
      </div>
    </section>
  )
}

/**
 * Anhaenge stehen ueber dem Text, nicht darunter: sie sind oft der eigentliche
 * Inhalt der Mail und sollen nicht am Ende einer langen Nachricht versauern.
 * Ein Klick oeffnet die Datei, der Knopf daneben speichert sie.
 */
function AttachmentBar({ message, body }: { message: MessageSummary; body: MessageBody }) {
  const previews = body.previews ?? {}
  const totalSize = body.attachments.reduce((sum, att) => sum + att.size, 0)

  return (
    <div className="attachments" aria-label="Anhaenge">
      <div className="attachments-head">
        <IconPaperclip size={13} />
        <span>{body.attachments.length === 1 ? '1 Anhang' : `${body.attachments.length} Anhaenge`}</span>
        <span className="size">{fileSize(totalSize)}</span>
      </div>

      <div className="attachment-row">
        {body.attachments.map((att) => {
          const preview = previews[att.partId]
          return (
            <div className="attachment" key={att.partId}>
              <button
                className="attachment-main"
                onClick={() =>
                  void window.api.attachments.open(
                    message.accountId,
                    message.folder,
                    message.uid,
                    att.partId,
                    att.filename
                  )
                }
                title={`${att.filename} oeffnen`}
              >
                <span className="attachment-thumb">
                  {preview ? (
                    <img src={preview} alt="" draggable={false} />
                  ) : (
                    <span className="attachment-ext">{typeLabel(att.filename, att.contentType)}</span>
                  )}
                </span>
                <span className="attachment-text">
                  <span className="name">{att.filename}</span>
                  <span className="size">{fileSize(att.size)}</span>
                </span>
              </button>
              <button
                className="attachment-save"
                onClick={() =>
                  void window.api.attachments.save(
                    message.accountId,
                    message.folder,
                    message.uid,
                    att.partId,
                    att.filename
                  )
                }
                title={`${att.filename} speichern`}
                aria-label={`${att.filename} speichern`}
              >
                <IconDownload size={15} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Kurzes Kuerzel fuer Dateien ohne Bildvorschau, z. B. "PDF". */
function typeLabel(filename: string, contentType: string): string {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(filename)?.[1]
  const fromType = contentType.split('/')[1]?.split(/[;+]/)[0]
  return (fromName || fromType || 'Datei').toUpperCase().slice(0, 4)
}

function MailContent({
  body,
  loading,
  error,
  allowRemote,
  domain,
  zoom,
  sheetWidth,
  onContentWidth,
  onZoomStep,
  onAllowRemote,
  onTrustDomain
}: {
  body: MessageBody | null
  loading: boolean
  error: string | null
  allowRemote: boolean
  /** Absenderdomain, leer wenn sie sich nicht bestimmen liess. */
  domain: string
  zoom: number
  sheetWidth: number
  onContentWidth: (width: number) => void
  onZoomStep: (step: ZoomStep) => void
  onAllowRemote: () => void
  onTrustDomain: () => void
}) {
  const prepared = useMemo(() => {
    if (!body) return null
    if (body.html) {
      const { html, blockedRemote } = sanitizeMailHtml(body.html, body.inlineImages, allowRemote)
      return { doc: wrapMailDocument(html), blockedRemote, plain: null as string | null }
    }
    return { doc: null, blockedRemote: 0, plain: body.text ?? '' }
  }, [body, allowRemote])

  if (loading && !body) {
    return <div className="plain-body">Wird geladen&hellip;</div>
  }
  if (error) {
    return <div className="plain-body">{error}</div>
  }
  if (!prepared) {
    return <div className="plain-body">Diese Nachricht hat keinen Inhalt.</div>
  }

  return (
    <div className="sheet-body">
      {prepared.blockedRemote > 0 && (
        <p className="remote-notice" style={{ zoom }}>
          <span>
            {prepared.blockedRemote === 1
              ? 'Ein externes Bild wurde blockiert.'
              : `${prepared.blockedRemote} externe Bilder wurden blockiert.`}{' '}
            Absender erkennen daran, wann du eine Mail oeffnest.
          </span>
          <span className="remote-actions">
            <button className="link-btn" onClick={onAllowRemote}>
              Bilder laden
            </button>
            {domain && (
              <button
                className="link-btn"
                onClick={onTrustDomain}
                title={`Bilder von ${domain} kuenftig ohne Nachfrage laden`}
              >
                Immer von {domain}
              </button>
            )}
          </span>
        </p>
      )}
      {prepared.doc ? (
        <MailFrame
          html={prepared.doc}
          zoom={zoom}
          sheetWidth={sheetWidth}
          onContentWidth={onContentWidth}
          onZoomStep={onZoomStep}
        />
      ) : (
        <div
          className="plain-body"
          style={{ zoom }}
          // Der Text wurde beim Umwandeln maskiert; nur die erkannten Links sind HTML.
          dangerouslySetInnerHTML={{ __html: textToHtml(prepared.plain ?? '') }}
        />
      )}
    </div>
  )
}

/**
 * Nachrichteninhalt in einem iframe ohne allow-scripts: nichts aus der Mail
 * kann laufen. allow-same-origin bleibt drin, damit die Hoehe messbar ist -
 * ohne allow-scripts ist das ungefaehrlich, weil es nichts gibt, was den
 * Zugriff nutzen koennte.
 */
function MailFrame({
  html,
  zoom,
  sheetWidth,
  onContentWidth,
  onZoomStep
}: {
  html: string
  zoom: number
  /** Breite des Blatts in Normalgroesse */
  sheetWidth: number
  /** Meldet die Breite der vergroesserten Mail; 0 heisst: sie passt aufs Blatt */
  onContentWidth: (width: number) => void
  onZoomStep: (step: ZoomStep) => void
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(320)
  /*
    Solange Strg gedrueckt ist, nimmt der Rahmen keine Maus an: dann landet
    Strg+Mausrad sicher beim Fenster. Im Rahmen selbst kaeme es nicht
    zuverlaessig an - waechst die Mail, waehrend der Zeiger stillsteht, schickt
    Chromium dem Rahmen gar keine Radereignisse mehr.
  */
  const [ctrlHeld, setCtrlHeld] = useState(false)
  /** Breite des Rahmens, solange vergroessert ist */
  const [frameWidth, setFrameWidth] = useState(0)
  const sheetWidthRef = useRef(sheetWidth)
  sheetWidthRef.current = sheetWidth
  const reportRef = useRef(onContentWidth)
  reportRef.current = onContentWidth

  // Ueber Referenzen, damit ein Zoomschritt oder ein neuer Rueckruf nicht das
  // ganze Dokument neu bindet - das wuerde die Mail neu aufbauen.
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const stepRef = useRef(onZoomStep)
  stepRef.current = onZoomStep

  /*
    Zwei Masse, beide in Bildschirmpixeln und beide unabhaengig davon, wie hoch
    der Rahmen gerade ist - sonst koennte die Hoehe nur wachsen und beim
    Verkleinern bliebe ein weisses Feld unter der Mail stehen.

    Das erste ist der Koerper der Nachricht; seine Hoehe richtet sich nach dem
    Inhalt, nicht nach dem Rahmen. Das zweite faengt Inhalt, der aus dem Koerper
    herauslaeuft, und wird am kurz zusammengefalteten Rahmen genommen; gezeichnet
    wird dazwischen nicht, weil beide Zuweisungen in derselben Aufgabe stehen.

    body.scrollHeight taugt fuer keines von beiden: es zaehlt im eigenen Massstab
    des vergroesserten Elements und meldete bei 70% weiterhin die volle Hoehe.
  */
  /*
    Beim Vergroessern bricht der Text neu um, damit er aufs Blatt passt - aber
    nichts, was in Normalgroesse eine feste Breite hat, wird schmaler: Bilder
    behalten mindestens ihre Breite von 100%, und eine Newsletter-Tabelle mit
    600px bleibt 600px breit. Was dann nicht mehr aufs Blatt passt, macht das
    Blatt breiter, und der Lesebereich scrollt seitlich.

    Dafuer wird erst das Layout der Normalgroesse vermessen. Danach ist der
    Koerper so breit, wie es der Platz bei dieser Vergroesserung hergibt, aber
    nie schmaler als sein starrster Inhalt.
  */
  const applyZoom = useCallback((doc: Document): void => {
    const body = doc.body
    if (!body) return
    const zoom = zoomRef.current
    const sheet = sheetWidthRef.current
    const images = Array.from(doc.images)

    if (zoom <= 1 || sheet <= 0) {
      body.style.zoom = String(zoom)
      body.style.width = ''
      body.style.boxSizing = ''
      for (const img of images) img.style.minWidth = ''
      setFrameWidth(0)
      reportRef.current(0)
      return
    }

    body.style.zoom = '1'
    body.style.boxSizing = 'border-box'
    body.style.width = `${sheet}px`
    for (const img of images) img.style.minWidth = ''
    const widths = images.map((img) => img.getBoundingClientRect().width)
    images.forEach((img, i) => {
      // min-width schlaegt das max-width: 100% aus dem Grundstil.
      if (widths[i] > 0) img.style.minWidth = `${widths[i]}px`
    })
    body.style.width = 'min-content'
    const rigid = Math.ceil(body.getBoundingClientRect().width)
    const layout = Math.min(sheet, Math.max(sheet / zoom, rigid))
    body.style.width = `${layout}px`
    body.style.zoom = String(zoom)

    const rendered = Math.ceil(layout * zoom)
    setFrameWidth(rendered)
    reportRef.current(rendered > sheet ? rendered : 0)
  }, [])

  const measure = useCallback((): void => {
    const iframe = ref.current
    const doc = iframe?.contentDocument
    const root = doc?.documentElement
    if (!iframe || !root) return
    const koerper = doc?.body?.getBoundingClientRect().height ?? 0
    const gesetzt = iframe.style.height
    iframe.style.height = '0px'
    const ueberlauf = root.scrollHeight
    iframe.style.height = gesetzt
    // 40000px als Notbremse gegen Mails mit absurd langen Anhaengen im Body.
    // Aufgerundet: ein halber Pixel zu wenig schneidet die letzte Zeile an.
    setHeight(Math.ceil(Math.min(Math.max(koerper, ueberlauf, 80), 40000)))
  }, [])

  useEffect(() => {
    const iframe = ref.current
    if (!iframe) return
    let observer: ResizeObserver | null = null
    let timers: number[] = []
    let detachZoom: (() => void) | null = null

    const release = (): void => {
      observer?.disconnect()
      observer = null
      detachZoom?.()
      detachZoom = null
      for (const id of timers) window.clearTimeout(id)
      timers = []
    }

    /*
      Ein srcDoc-Rahmen durchlaeuft zwei Dokumente: erst ein leeres, dann die
      Mail - und beide melden "load". Gebunden wird deshalb jedes Mal neu, sonst
      haengen Messung und Zoomgriff am weggeworfenen ersten Dokument. Die Hoehe
      muss stimmen, weil der Rahmen bewusst nicht selbst scrollt; Bilder,
      Schriften und spaet gesetzte Breiten aendern sie noch, daher das mehrfache
      Nachmessen.
    */
    const bind = (): void => {
      release()
      const doc = iframe.contentDocument
      if (!doc?.documentElement) return
      applyZoom(doc)
      measure()
      // Tasten auch im Nachrichtendokument: hat es den Eingabefokus, sieht das
      // Fenster sie nicht. Das Mausrad kommt nie hier an, siehe ctrlHeld.
      const parts = [
        attachZoomKeys(doc, (step) => stepRef.current(step)),
        attachCtrlWatch(doc, setCtrlHeld)
      ]
      detachZoom = () => parts.forEach((detach) => detach())
      observer = new ResizeObserver(measure)
      observer.observe(doc.documentElement)
      if (doc.body) observer.observe(doc.body)
      // Ein spaet geladenes Bild aendert Breite und Hoehe der Mail.
      const relayout = (): void => {
        applyZoom(doc)
        measure()
      }
      for (const img of Array.from(doc.images)) {
        if (!img.complete) {
          img.addEventListener('load', relayout, { once: true })
          img.addEventListener('error', relayout, { once: true })
        }
      }
      timers = [120, 500, 1500].map((ms) => window.setTimeout(measure, ms))
    }

    iframe.addEventListener('load', bind)
    // Falls das Dokument schon steht, bevor der Griff hier haengt.
    bind()
    return () => {
      iframe.removeEventListener('load', bind)
      release()
    }
  }, [applyZoom, html, measure])


  // Die Vergroesserung sitzt im Mail-Dokument, damit sie Text und Bilder der
  // Nachricht trifft und sonst nichts. Danach ist die Mail hoeher oder
  // niedriger als vorher - der Rahmen muss mitwachsen.
  useEffect(() => {
    const doc = ref.current?.contentDocument
    if (!doc?.body) return
    applyZoom(doc)
    measure()
  }, [applyZoom, sheetWidth, zoom, html, measure])

  useEffect(() => attachCtrlWatch(window, setCtrlHeld), [])

  return (
    <iframe
      ref={ref}
      title="Nachrichteninhalt"
      srcDoc={html}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      style={{
        height,
        width: zoom > 1 && frameWidth ? frameWidth : undefined,
        pointerEvents: ctrlHeld ? 'none' : undefined
      }}
    />
  )
}

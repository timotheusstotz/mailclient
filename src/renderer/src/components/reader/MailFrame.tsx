import { useCallback, useEffect, useRef, useState } from 'react'
import { attachCtrlWatch, attachZoomKeys, type ZoomStep } from '../../lib/zoom'

/**
 * Nachrichteninhalt in einem iframe ohne allow-scripts: nichts aus der Mail
 * kann laufen. allow-same-origin bleibt drin, damit die Hoehe messbar ist -
 * ohne allow-scripts ist das ungefaehrlich, weil es nichts gibt, was den
 * Zugriff nutzen koennte.
 */
export function MailFrame({
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

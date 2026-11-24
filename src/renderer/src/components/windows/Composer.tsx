import { useEffect, useId, useRef, useState } from 'react'
import type { Account, ComposeSeed, DraftFailure, DraftRef, MailTemplate, OutgoingAttachment, OutgoingMessage, SendResult } from '@shared/types'
import { draftFailureOf, draftFailureSentence } from '@shared/types'
import { toLocalInput } from '@shared/times'
import { counted, displayName, fileSize, formatAddressFull, parseAddresses } from '../../lib/format'
import type { ComposerHandle } from '../../lib/useWindows'
import {
  IconCheck,
  IconChevron,
  IconClock,
  IconClose,
  IconCompose,
  IconPaperclip,
  IconPlus,
  IconRefresh,
  IconSave,
  IconSent,
  IconSpinner,
  IconTemplate,
  IconTrash,
  IconWarn
} from '../icons'
import { fileKind } from '../reader/Attachments'
import { MenuButton, MenuItem } from '../reader/Menu'
import { TimeMenu } from '../reader/TimeMenu'
import { AddressField } from './AddressField'
import { useWindowMotion } from './motion'
import { WindowControls } from './WindowControls'

interface Props {
  /** Fester Schluessel des Fensters, solange es offen ist */
  windowId: string
  accounts: Account[]
  seed: ComposeSeed
  templates: MailTemplate[]
  /** Aufgeklappt; sonst liegt es unsichtbar in der Leiste und behaelt alles. */
  expanded: boolean
  /** Geschlossen, blendet aus */
  leaving: boolean
  /** Minimieren: useWindows sichert vorher. */
  onMinimize: () => void
  /** Das Fenster ist zu (gespeichert, verworfen oder gesendet). */
  onClosed: () => void
  onSent: (result: SendResult) => void
  /** Betreff fuer den Reiter in der Leiste */
  onTitle: (title: string) => void
  /** Der Speicherstand fuer den Reiter */
  onSaveFailed: (failed: boolean) => void
  /** Neue Kennung des Entwurfs: jede Fassung bekommt auf dem Server eine neue UID. */
  onSaved: (ref: DraftRef) => void
  register: (id: string, handle: ComposerHandle | null) => void
}

/** Fehlermeldung aus Electrons IPC-Umschlag holen. */
function cleanError(err: unknown): string {
  return (err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

/** Vorlagentext als HTML: maskiert, Zeilenumbrueche bleiben. */
function templateHtml(body: string): string {
  return body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>')
}

interface AttachmentDraft extends OutgoingAttachment {
  size: number
}

/** Liest eine abgelegte oder eingefuegte Datei als Anhang ein. */
function readAttachment(file: File, filename: string): Promise<AttachmentDraft> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      resolve({
        filename,
        content: url.slice(url.indexOf(',') + 1),
        contentType: file.type || 'application/octet-stream',
        size: file.size
      })
    }
    reader.onerror = () => reject(reader.error ?? new Error(`${filename} ließ sich nicht lesen.`))
    reader.readAsDataURL(file)
  })
}

/**
 * Chromium nennt jedes eingefuegte Bild "image.png". Drei Screenshots hiessen
 * sonst gleich - und beim Empfaenger ueberschriebe einer den anderen.
 */
function pastedName(file: File, index: number): string {
  if (file.name && file.name !== 'image.png') return file.name
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
  return `Einfuegung-${stamp}${index ? `-${index + 1}` : ''}.${ext}`
}

/** Nur Ziehvorgaenge mit Dateien gehen uns etwas an - Text im Editor zieht weiter wie gewohnt. */
function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

/** Ab hier lehnen viele Server die Mail ab. */
const SIZE_LIMIT = 20e6

/** So lange darf Speichern dauern, bevor "Wird gespeichert …" erscheint. */
const SLOW_SAVE_MS = 300

/** So lange bleibt das X nach einem gescheiterten Schliessen scharf. */
const ARMED_MS = 6000

const failureSentence = draftFailureSentence

const clock = (ms: number): string => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

/** Kopf des Fensters: was es ist, nicht der Betreff - der steht im Feld und am Reiter. */
function windowTitle(seed: ComposeSeed): string {
  if (seed.mode === 'forward') return 'Weiterleitung'
  if (seed.mode === 'reply' || seed.mode === 'replyAll') return seed.to.length ? `Antwort an ${displayName(seed.to[0])}` : 'Antwort'
  return 'Neue Nachricht'
}

/** Adressen fuer ein Empfaengerfeld: fertige Eintraege enden mit Komma, damit sie als Marken stehen. */
function addressLine(list: { name?: string; address: string }[]): string {
  return list.length ? `${list.map(formatAddressFull).join(', ')}, ` : ''
}

export function Composer({
  windowId,
  accounts,
  seed,
  templates,
  expanded,
  leaving,
  onMinimize,
  onClosed,
  onSent,
  onTitle,
  onSaveFailed,
  onSaved,
  register
}: Props) {
  const draft = seed.draft
  const [accountId, setAccountId] = useState(seed.accountId)
  const [to, setTo] = useState(addressLine(draft?.to ?? seed.to))
  const [cc, setCc] = useState(addressLine(draft?.cc ?? seed.cc))
  const [bcc, setBcc] = useState(addressLine(draft?.bcc ?? seed.bcc ?? []))
  const [showCc, setShowCc] = useState(seed.cc.length > 0 || Boolean(draft?.cc.length || draft?.bcc.length))
  const [subject, setSubject] = useState(seed.subject)
  const [attachments, setAttachments] = useState<AttachmentDraft[]>(() =>
    // Die Groesse stand nie in der Nachricht; aus der base64-Laenge ergibt sie sich nahezu genau.
    (draft?.attachments ?? []).map((a) => ({ ...a, size: Math.floor((a.content.length * 3) / 4) }))
  )
  /** Eingabefeld fuer einen freien Versandtermin; null = nicht sichtbar */
  const [customAt, setCustomAt] = useState<string | null>(null)
  // Die Schreibmarke im Text. Ein Klick auf "Vorlage" nimmt dem Editor den
  // Fokus - eingesetzt wird trotzdem dort, wo zuletzt geschrieben wurde.
  const caret = useRef<Range | null>(null)
  const [sending, setSending] = useState(false)
  /** Was sonst schiefging: Senden, ein Anhang, ein Ordner beim Ablegen */
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const sectionRef = useRef<HTMLElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const toRef = useRef<HTMLInputElement>(null)
  const ccRef = useRef<HTMLInputElement>(null)
  const titleId = useId()

  const hidden = useWindowMotion(sectionRef, windowId, expanded, leaving)
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0]
  // Nur das aufgeklappte Fenster traegt die festen ids; die in der Leiste
  // liegenden haetten sonst dieselben, und Beschriftungen zeigten ins Leere.
  const idp = expanded ? 'compose' : `compose-${windowId}`

  // ------------------------------------------------------------ Entwurf
  const draftRef = useRef<DraftRef | undefined>(seed.draftRef)
  /** Stand beim Oeffnen oder letzten Speichern; null = noch nie festgehalten. */
  const savedState = useRef<string | null>(null)
  /** Speichervorgaenge eines Fensters laufen nacheinander, nie parallel. */
  const saving = useRef<Promise<unknown>>(Promise.resolve())
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [saveFailed, setSaveFailed] = useState<DraftFailure | null>(null)
  /** Das Konto, bei dem es scheiterte - fuer den Satz in der Fehlerzeile */
  const [failedAccount, setFailedAccount] = useState('')
  /** Ein Speichern dauert laenger als 300 ms */
  const [slow, setSlow] = useState(false)

  const collect = (): OutgoingMessage => ({
    accountId: account?.id ?? accountId,
    to: parseAddresses(to),
    cc: parseAddresses(cc),
    bcc: parseAddresses(bcc),
    subject: subject.trim(),
    html: editorRef.current?.innerHTML ?? '',
    text: editorRef.current?.innerText ?? '',
    attachments: attachments.map(({ size: _size, ...rest }) => rest),
    inReplyTo: seed.inReplyTo,
    references: seed.references
  })

  const snapshot = (): string => {
    const m = collect()
    return JSON.stringify([m.accountId, m.to, m.cc, m.bcc, m.subject, m.html, m.attachments.map((a) => a.content.length)])
  }

  /** Speichert, wenn sich seit dem letzten Stand etwas geaendert hat. */
  const flush = (): Promise<boolean> => {
    const current = snapshot()
    const message = collect()
    const run = saving.current.then(async () => {
      if (current === savedState.current) return true
      const timer = window.setTimeout(() => setSlow(true), SLOW_SAVE_MS)
      try {
        draftRef.current = await window.api.drafts.save(message, draftRef.current)
        onSaved(draftRef.current)
        savedState.current = current
        setSavedAt(Date.now())
        setSaveFailed(null)
        return true
      } catch (err) {
        setFailedAccount(accounts.find((a) => a.id === message.accountId)?.label ?? 'Das Konto')
        setSaveFailed(draftFailureOf(cleanError(err)))
        return false
      } finally {
        window.clearTimeout(timer)
        setSlow(false)
      }
    })
    saving.current = run
    return run
  }

  /*
    Scheitert das Speichern beim Schliessen, bleibt das Fenster offen und das
    X wird scharf: der zweite Klick schliesst ohne Speichern. Scharf bleibt es
    6 s, bis getippt wird oder bis "Erneut versuchen".
  */
  const [armed, setArmed] = useState(false)
  const armedRef = useRef(false)
  armedRef.current = armed
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), ARMED_MS)
    return () => window.clearTimeout(timer)
  }, [armed])

  const close = async (): Promise<boolean> => {
    if (armedRef.current || (await flush())) {
      onClosed()
      return true
    }
    setArmed(true)
    return false
  }

  const retry = (): void => {
    setArmed(false)
    void flush()
  }

  const discard = async (): Promise<void> => {
    await saving.current
    const ref = draftRef.current
    if (ref) {
      try {
        await window.api.drafts.discard(ref)
      } catch (err) {
        setError(`Der Entwurf ließ sich nicht verwerfen. ${failureSentence(draftFailureOf(cleanError(err)), account?.label ?? 'Das Konto')}`)
        return
      }
    }
    onClosed()
  }

  useEffect(() => {
    register(windowId, { flush, close })
  })
  useEffect(() => () => register(windowId, null), [register, windowId])
  // Nur bei Aenderung melden; die Rueckrufe der App wechseln mit jedem Rendern.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onTitle(subject.trim()), [subject])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onSaveFailed(saveFailed !== null), [saveFailed])

  // Aus der Leiste zurueck: weiterschreiben koennen, und Esc landet hier. Erst
  // wenn das Fenster wieder sichtbar ist - ein verstecktes nimmt keinen Fokus.
  const shown = expanded && !hidden
  const wasShown = useRef(shown)
  useEffect(() => {
    if (!wasShown.current && shown) editorRef.current?.focus()
    wasShown.current = shown
  }, [shown])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    // Was von aussen kam (mailto, aus dem Ausgang zurueckgeholt), steht sonst
    // nirgends: das gilt von Anfang an als ungespeichert. Eine unveraenderte
    // Antwort oder ein schon gespeicherter Entwurf nicht.
    const fromOutside =
      !seed.draftRef && Boolean(seed.external)
    const settle = (): void => {
      savedState.current = fromOutside ? null : snapshot()
    }
    if (draft) {
      // Zurueckgeholt aus dem Ausgang oder ein Entwurf: genau so, wie er war.
      editor.innerHTML = draft.html
      editor.focus()
      settle()
      return
    }
    const signature = account?.signature ? `<p></p><div>--<br>${account.signature.replace(/\n/g, '<br>')}</div>` : '<p></p>'
    editor.innerHTML = `${seed.bodyHtml ?? '<p><br></p>'}${signature}${seed.quotedHtml}`
    // Bei einer Antwort steht der Empfaenger schon fest, der Cursor gehoert
    // in den Text; bei einer neuen Mail ist das Adressfeld dran.
    if (seed.to.length) editor.focus()
    else toRef.current?.focus()
    settle()
    // Nur beim ersten Aufbau - spaeteres Tippen darf nicht ueberschrieben werden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ----------------------------------------------------------- Anhaenge
  const pickAttachments = async (): Promise<void> => {
    const picked = await window.api.attachments.pick()
    setAttachments((prev) => [...prev, ...picked])
  }

  const addFiles = async (files: File[], naming: (file: File, index: number) => string): Promise<void> => {
    if (!files.length) return
    try {
      const read = await Promise.all(files.map((file, index) => readAttachment(file, naming(file, index))))
      setAttachments((prev) => [...prev, ...read])
    } catch (err) {
      setError(`Ein Anhang ließ sich nicht lesen: ${(err as Error).message}`)
    }
  }

  /*
    Dateien ablegen: auf dem Fenster und knapp daneben - die Ereignisse haengen
    an der ganzen Flaeche hinter dem Fenster, solange es aufgeklappt ist.
    dragenter und dragleave feuern an jedem Kindelement; erst bei 0 ist der
    Zeiger wirklich draussen. Ohne Zaehler flackert der Hinweis.
  */
  const addFilesRef = useRef(addFiles)
  addFilesRef.current = addFiles
  useEffect(() => {
    const area = sectionRef.current?.parentElement
    if (!expanded || !area) return
    let depth = 0
    const enter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth++
      setDragging(true)
    }
    const over = (event: DragEvent): void => {
      if (!carriesFiles(event)) return
      // Ohne preventDefault gilt die Stelle als "hier nicht ablegen".
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const leave = (event: DragEvent): void => {
      if (!carriesFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const drop = (event: DragEvent): void => {
      if (!carriesFiles(event) || !event.dataTransfer) return
      // Sonst fuegt der Editor selbst etwas ein oder das Fenster will zur Datei navigieren.
      event.preventDefault()
      depth = 0
      setDragging(false)
      // Die Eintraege nur jetzt lesen: nach dem Ereignis gibt der Browser sie nicht mehr her.
      const files: File[] = []
      let folders = 0
      for (const item of Array.from(event.dataTransfer.items)) {
        if (item.kind !== 'file') continue
        if (item.webkitGetAsEntry()?.isDirectory) {
          folders++
          continue
        }
        const file = item.getAsFile()
        if (file) files.push(file)
      }
      if (folders) {
        setError(
          folders === 1
            ? 'Ordner lassen sich nicht anhängen. Leg die Dateien darin ab oder zippe den Ordner vorher.'
            : `${folders} Ordner übersprungen, Ordner lassen sich nicht anhängen.`
        )
      }
      void addFilesRef.current(files, (file) => file.name || 'anhang')
    }
    area.addEventListener('dragenter', enter)
    area.addEventListener('dragover', over)
    area.addEventListener('dragleave', leave)
    area.addEventListener('drop', drop)
    return () => {
      area.removeEventListener('dragenter', enter)
      area.removeEventListener('dragover', over)
      area.removeEventListener('dragleave', leave)
      area.removeEventListener('drop', drop)
      setDragging(false)
    }
  }, [expanded])

  const onPaste = (event: React.ClipboardEvent): void => {
    const files = Array.from(event.clipboardData.files)
    if (!files.length) return
    const types = Array.from(event.clipboardData.types)
    const carriesText = types.includes('text/plain') || types.includes('text/html')
    // Aus Word oder dem Browser kopierter Text bringt oft ein Bild derselben
    // Stelle mit. Gemeint ist dann der Text, nicht ein Bild davon.
    if (carriesText && files.every((file) => file.type.startsWith('image/'))) return
    event.preventDefault()
    void addFiles(files, pastedName)
  }

  // ------------------------------------------------------------ Vorlagen
  const rememberCaret = (): void => {
    const selection = window.getSelection()
    const editor = editorRef.current
    if (!selection?.rangeCount || !editor) return
    const range = selection.getRangeAt(0)
    if (editor.contains(range.commonAncestorContainer)) caret.current = range.cloneRange()
  }

  const insertTemplate = (template: MailTemplate): void => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    const selection = window.getSelection()
    if (selection) {
      const range = caret.current ?? document.createRange()
      // Ohne gemerkte Stelle: ganz an den Anfang, vor Signatur und Zitat.
      if (!caret.current) {
        range.selectNodeContents(editor)
        range.collapse(true)
      }
      selection.removeAllRanges()
      selection.addRange(range)
    }
    document.execCommand('insertHTML', false, templateHtml(template.body))
    rememberCaret()
    if (!subject.trim() && template.subject) setSubject(template.subject)
  }

  // -------------------------------------------------------------- Senden
  const send = async (sendAt?: number): Promise<void> => {
    setError(null)
    if (!parseAddresses(to).length) {
      setError('Trag mindestens einen Empfänger ein.')
      toRef.current?.focus()
      return
    }
    if (!account) {
      setError('Es gibt kein Konto zum Senden.')
      return
    }

    const message = collect()
    setSending(true)
    try {
      const result = await window.api.mail.send({ ...message, subject: message.subject || '(kein Betreff)' }, sendAt ? { sendAt } : undefined)
      // Die Nachricht ist raus oder wartet im Ausgang; der Entwurf hat ausgedient.
      await saving.current
      if (draftRef.current) void window.api.drafts.drop(draftRef.current).catch(() => {})
      onSent(result)
    } catch (err) {
      setError(cleanError(err))
      setSending(false)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.defaultPrevented) return
    const mod = event.ctrlKey || event.metaKey
    if (event.key === 'Escape') {
      event.preventDefault()
      void close()
    } else if (mod && event.key === 'Enter') {
      event.preventDefault()
      void send()
    } else if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void flush()
    }
  }

  const totalSize = attachments.reduce((sum, a) => sum + a.size, 0)

  return (
    <section
      ref={sectionRef}
      className="cw compose-dialog"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      hidden={hidden}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onInput={() => armed && setArmed(false)}
    >
      {dragging && (
        <div className="cw-drop" aria-hidden="true">
          Loslassen, um anzuhängen
        </div>
      )}
      <header className="cw-head">
        <span className="cw-kind" aria-hidden="true">
          <IconCompose size={15} />
        </span>
        <h2 className="cw-title" id={titleId}>
          {windowTitle(seed)}
        </h2>
        <SaveState savedAt={savedAt} slow={slow} failed={saveFailed !== null} />
        <span className="cw-sep" aria-hidden="true" />
        <WindowControls
          closeTitle="Schließen, Entwurf bleibt (Esc)"
          armed={armed}
          onMinimize={onMinimize}
          onClose={() => void close()}
        />
      </header>

      {saveFailed !== null && (
        <div className="cw-err" role="alert">
          <span className="cw-err-mark" aria-hidden="true">
            <IconWarn size={15} />
          </span>
          <span className="cw-err-txt">
            <b>Der Entwurf ließ sich nicht speichern.</b>{' '}
            <span>
              {failureSentence(saveFailed, failedAccount)} Dein Text bleibt in diesem Fenster
              {savedAt ? `, zuletzt gespeichert um ${clock(savedAt)}` : ''}.
            </span>
          </span>
          <button type="button" className="rv-btn rv-btn--s rv-btn--outline" onClick={retry}>
            <IconRefresh />
            Erneut versuchen
          </button>
        </div>
      )}
      {error && (
        <div className="cw-err" role="alert">
          <span className="cw-err-mark" aria-hidden="true">
            <IconWarn size={15} />
          </span>
          <span className="cw-err-txt">{error}</span>
        </div>
      )}

      <div className="cw-fields">
        <div className="cw-line">
          <span className="cw-k">Von</span>
          <MenuButton
            label={account ? `Von: ${account.displayName || account.label}, ${account.email}` : 'Von'}
            title="Absender wählen"
            className="cw-pick"
            menuLabel="Absender"
            menuClassName="rv-menu rv-menu--start"
            menu={() =>
              accounts.map((a) => (
                <MenuItem
                  key={a.id}
                  icon={<span className="cw-dot" style={{ '--a': a.color } as React.CSSProperties} />}
                  meta={a.email}
                  current={a.id === account?.id}
                  onSelect={() => setAccountId(a.id)}
                >
                  {a.displayName || a.label}
                </MenuItem>
              ))
            }
          >
            {account && <span className="cw-dot" style={{ '--a': account.color } as React.CSSProperties} />}
            <span>{account ? account.displayName || account.label : 'Kein Konto'}</span>
            {account && <span className="cw-pick-addr">{account.email}</span>}
            <IconChevron size={14} />
          </MenuButton>
          <span />
        </div>

        <AddressField
          id={`${idp}-to`}
          label="An"
          value={to}
          onChange={setTo}
          inputRef={toRef}
          placeholder="name@beispiel.de"
          trailing={
            !showCc && (
              <button
                type="button"
                className="rv-btn rv-btn--s"
                onClick={() => {
                  setShowCc(true)
                  window.setTimeout(() => ccRef.current?.focus())
                }}
              >
                <IconPlus size={13} />
                Kopie, Blindkopie
              </button>
            )
          }
        />
        {showCc && (
          <>
            <AddressField id={`${idp}-cc`} label="Kopie" value={cc} onChange={setCc} inputRef={ccRef} />
            <AddressField id={`${idp}-bcc`} label="Blindkopie" value={bcc} onChange={setBcc} />
          </>
        )}

        <div className="cw-line">
          <label className="cw-k" htmlFor={`${idp}-subject`}>
            Betreff
          </label>
          <textarea
            id={`${idp}-subject`}
            className="cw-subject"
            rows={1}
            value={subject}
            placeholder="Worum geht es?"
            // Ein Betreff hat keine Zeilen: Enter geht in den Text, eingefuegte Umbrueche werden Leerzeichen.
            onChange={(e) => setSubject(e.target.value.replace(/\r?\n/g, ' '))}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return
              e.preventDefault()
              editorRef.current?.focus()
            }}
          />
          <span />
        </div>
      </div>

      <div
        className="cw-editor compose-editor"
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Nachrichtentext"
        onBlur={rememberCaret}
        onKeyUp={rememberCaret}
        onMouseUp={rememberCaret}
      />

      {attachments.length > 0 && (
        <section className="cw-att" aria-label="Anhänge">
          <div className="rv-att-head">
            <IconPaperclip size={14} />
            <span className={`cw-att-size${totalSize > SIZE_LIMIT ? ' is-over' : ''}`}>
              {counted(attachments.length, 'Anhang', 'Anhänge')} · {fileSize(totalSize)}
              {totalSize > SIZE_LIMIT && ' · viele Server lehnen mehr als 20 MB ab'}
            </span>
            <span className="cw-att-hint">Dateien hineinziehen oder mit Strg+V einfügen</span>
          </div>
          <div className="rv-att-grid">
            {attachments.map((att, index) => {
              const kind = fileKind(att.filename, att.contentType)
              return (
                <div className="rv-tile" key={`${att.filename}-${index}`}>
                  <span className="rv-tile-open">
                    <span className={`rv-thumb rv-thumb--${kind.tone}`}>
                      {kind.tone === 'img' ? <img src={`data:${att.contentType};base64,${att.content}`} alt="" draggable={false} /> : kind.label}
                    </span>
                    <span className="rv-ttext">
                      <span className="rv-tname">{att.filename}</span>
                      <span className="rv-tsize">{fileSize(att.size)}</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    className="rv-btn rv-btn--icon"
                    aria-label={`${att.filename} entfernen`}
                    title="Entfernen"
                    onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <IconClose />
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {customAt !== null && (
        <div className="cw-schedule">
          <label htmlFor={`${idp}-send-at`}>Senden am</label>
          <input
            id={`${idp}-send-at`}
            className="input"
            type="datetime-local"
            value={customAt}
            min={toLocalInput(Date.now())}
            onChange={(e) => setCustomAt(e.target.value)}
          />
          <button
            type="button"
            className="rv-btn rv-btn--s rv-btn--primary"
            disabled={sending || !(new Date(customAt).getTime() > Date.now())}
            onClick={() => void send(new Date(customAt).getTime())}
          >
            Planen
          </button>
          <button type="button" className="rv-btn rv-btn--s" onClick={() => setCustomAt(null)}>
            Abbrechen
          </button>
        </div>
      )}

      <footer className="cw-foot" data-busy={sending || undefined}>
        <button type="button" className="rv-btn" title="Anhang" onClick={() => void pickAttachments()}>
          <IconPaperclip />
          <span className="cw-opt-lbl">Anhang</span>
        </button>
        {templates.length > 0 && (
          <MenuButton
            label="Vorlage"
            title="Textbaustein an der Schreibmarke einsetzen"
            className="rv-btn rv-btn--menu"
            menuLabel="Vorlage einsetzen"
            menuClassName="rv-menu rv-menu--up rv-menu--start"
            menu={() =>
              templates.map((template) => (
                <MenuItem key={template.id} icon={<IconTemplate />} onSelect={() => insertTemplate(template)}>
                  {template.name}
                </MenuItem>
              ))
            }
          >
            <IconTemplate />
            <span className="cw-opt-lbl">Vorlage</span>
            <IconChevron size={14} />
          </MenuButton>
        )}
        <div className="cw-grow" />
        <button
          type="button"
          className="rv-btn rv-btn--plain rv-btn--danger"
          title="Entwurf in den Papierkorb legen und Fenster schließen"
          onClick={() => void discard()}
        >
          <IconTrash />
          Verwerfen
        </button>
        <span className="cw-vsep" aria-hidden="true" />
        <button type="button" className="rv-btn rv-btn--outline" title="Als Entwurf speichern (Strg+S)" onClick={() => void flush()}>
          <IconSave />
          Als Entwurf speichern
        </button>
        <MenuButton
          label="Später senden"
          title="Die Nachricht wartet im Ausgang und geht zum gewählten Zeitpunkt raus. Dafür muss die App laufen."
          className="rv-btn rv-btn--menu"
          menuLabel="Senden um"
          menuClassName="rv-menu rv-menu--up"
          menu={() => (
            <TimeMenu
              title="Senden um"
              onPick={(at) => void send(at)}
              onAskCustom={() => setCustomAt(toLocalInput(Date.now() + 3_600_000))}
            />
          )}
        >
          <IconClock />
          Später senden
          <IconChevron size={14} />
        </MenuButton>
        <button type="button" className="rv-btn rv-btn--primary" title="Senden (Strg+Enter)" onClick={() => void send()}>
          <IconSent />
          {sending ? 'Wird gesendet' : 'Senden'}
        </button>
      </footer>
    </section>
  )
}

/** Die Zeile im Kopf: wann zuletzt gespeichert, ob es gerade dauert, ob es scheiterte. Vor dem ersten Speichern nichts. */
function SaveState({ savedAt, slow, failed }: { savedAt: number | null; slow: boolean; failed: boolean }) {
  if (failed) {
    return (
      <span className="cw-state is-err" role="status">
        <IconWarn size={14} />
        Nicht gespeichert
      </span>
    )
  }
  if (slow) {
    return (
      <span className="cw-state" role="status">
        <IconSpinner size={14} />
        Wird gespeichert …
      </span>
    )
  }
  if (!savedAt) return null
  return (
    <span className="cw-state" role="status">
      <IconCheck size={14} />
      Entwurf gespeichert · {clock(savedAt)}
    </span>
  )
}

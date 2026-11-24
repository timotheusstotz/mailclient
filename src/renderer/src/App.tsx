import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Account,
  ComposeMode,
  Folder,
  MessageBody,
  MessageSummary,
  OutgoingMessage,
  SendResult,
  ViewRef
} from '@shared/types'
import { collapseThreads, type ThreadRow } from '@shared/threads'
import { draftFailureOf, draftFailureSentence } from '@shared/types'
import { timePresets } from '@shared/times'
import { AccountWizard } from './components/AccountWizard'
import { Composer } from './components/windows/Composer'
import { MailWindow } from './components/windows/MailWindow'
import { WindowBar, useDockPresence } from './components/windows/WindowBar'
import { useWindows } from './lib/useWindows'
import { ContextMenu, type MenuItem, type MenuRequest } from './components/ContextMenu'
import { MessageList } from './components/list/MessageList'
import { SelectionPane } from './components/list/SelectionPane'
import { Reader } from './components/Reader'
import { AccountRail } from './components/sidebar/AccountRail'
import { FolderColumn } from './components/sidebar/FolderColumn'
import { FolderMenu } from './components/sidebar/FolderMenu'
import { moveChoices } from './lib/folders'
import { inPlace, viewInfo } from './lib/views'
import { SettingsDialog } from './components/SettingsDialog'
import { Splitter } from './components/Splitter'
import { TimeDialog } from './components/TimeDialog'
import { attachZoomKeys, attachZoomWheel, clampZoom, nextZoom, type ZoomStep } from './lib/zoom'
import {
  IconArchive,
  IconCheck,
  IconClock,
  IconCompose,
  IconEnvelopeOpen,
  IconFolder,
  IconForward,
  IconInbox,
  IconRefresh,
  IconReply,
  IconReplyAll,
  IconSettings,
  IconStar,
  IconTrash,
  IconUndo
} from './components/icons'
import { drawBadge } from './lib/badge'
import { addressList, counted, folderLabel, formatAddressFull, fullDate, shortDateTime } from './lib/format'
import { endMailDrag, startMailDrag } from './lib/mailDrag'
import { MailTokens } from './components/list/MailTokens'
import { flyToTrash, trashTarget, leaveRows, rowLaunchPoint } from './lib/listMotion'
import { addTrustedDomain } from './lib/remote-images'
import type { MailtoDraft } from '@shared/mailto'
import { textToEditorHtml } from './lib/sanitize'
import {
  runServerSearch,
  useMediaQuery,
  useMessageBody,
  useMessages,
  useSearch,
  useSyncFeedback,
  useTheme,
  useThread,
  useViewCounts,
  useWorkspace
} from './state'

const UNIFIED_INBOX: ViewRef = { kind: 'unified', id: 'inbox' }

/** Kurze Meldung am unteren Rand, auf Wunsch mit einem Knopf. */
interface Toast {
  text: string
  action?: { label: string; run: () => void }
  /** Ein Haken vor dem Text, wenn etwas erledigt ist */
  done?: boolean
}

/** Frage nach einem freien Zeitpunkt. */
interface TimeAsk {
  title: string
  confirm: string
  onPick: (at: number) => void
}

export default function App() {
  const workspace = useWorkspace()
  const { accounts, foldersByAccount, folders, settings, statuses, statusById, updateSettings } = workspace

  const [view, setView] = useState<ViewRef>(UNIFIED_INBOX)
  const [selected, setSelected] = useState<MessageSummary | null>(null)
  /** Mehrfachauswahl; enthaelt die Kennung von `selected` immer mit. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  /** Ausgangspunkt fuer Auswahl mit gedrueckter Umschalttaste */
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const wins = useWindows()
  const { openCompose } = wins
  /** Reiter der Leiste: geschlossene Fenster, die noch ausblenden, haben keinen mehr. */
  const openTabs = useMemo(() => wins.windows.filter((w) => !w.leaving), [wins.windows])
  const dock = useDockPresence(openTabs.length > 0)
  const [showSettings, setShowSettings] = useState(false)
  const [wizard, setWizard] = useState<{ account?: Account } | null>(null)
  const [menu, setMenu] = useState<MenuRequest | null>(null)
  /** Die Zeile, deren Kontextmenue offen ist; sie wird markiert, aber nicht geoeffnet */
  const [menuRowId, setMenuRowId] = useState<string | null>(null)
  useEffect(() => {
    if (!menu) setMenuRowId(null)
  }, [menu])
  const [encryptionAvailable, setEncryptionAvailable] = useState(true)
  const [toast, setToast] = useState<Toast | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [timeAsk, setTimeAsk] = useState<TimeAsk | null>(null)
  /** Mail aus der Unterhaltung, die statt der ausgewaehlten im Lesebereich steht */
  const [threadFocusId, setThreadFocusId] = useState<string | null>(null)
  /** Aus einer Benachrichtigung gemeldete Mail, die noch geoeffnet werden soll. */
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null)

  const search = useSearch()
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Ein Suchbegriff ueberlagert die gewaehlte Ansicht, ohne sie zu vergessen.
  const effectiveView: ViewRef = useMemo(() => {
    const text = search.debounced.trim()
    if (!text) return view
    return {
      kind: 'search',
      query: {
        text,
        accountId: view.kind === 'folder' ? view.accountId : undefined,
        folder: view.kind === 'folder' ? view.folder : undefined
      }
    }
  }, [search.debounced, view])

  const { messages, loading, patchFlags } = useMessages(effectiveView)

  /** Gelesen/ungelesen: sofort in der Liste, dann beim Server. */
  const markSeen = useCallback(
    (items: MessageSummary[], seen: boolean): Promise<void> => {
      patchFlags(new Set(items.map((m) => m.id)), '\\Seen', seen)
      return window.api.messages.setSeen(items, seen)
    },
    [patchFlags]
  )

  /*
    Die Liste zeigt Zeilen, nicht Mails: eine Zeile je Unterhaltung. `messages`
    bleibt die flache Liste zum Nachschlagen; ausgewaehlt und durchgeblaettert
    werden die Koepfe der Zeilen, und eine Aktion auf einer Zeile trifft alle
    Mails darunter.
  */
  const threaded = Boolean(settings?.threadView)
  const rows = useMemo<ThreadRow[]>(
    () => (threaded ? collapseThreads(messages) : messages.map((m) => ({ head: m, members: [m] }))),
    [messages, threaded]
  )
  const heads = useMemo(() => rows.map((row) => row.head), [rows])
  const rowByMember = useMemo(() => {
    const map = new Map<string, ThreadRow>()
    for (const row of rows) for (const member of row.members) map.set(member.id, row)
    return map
  }, [rows])
  const membersOf = useCallback(
    (message: MessageSummary): MessageSummary[] => rowByMember.get(message.id)?.members ?? [message],
    [rowByMember]
  )

  const thread = useThread(selected, threaded)
  /** Was im Lesebereich steht: die Auswahl oder eine andere Mail ihrer Unterhaltung. */
  const shown = useMemo(
    () => (threadFocusId ? (thread.find((m) => m.id === threadFocusId) ?? selected) : selected),
    [selected, thread, threadFocusId]
  )
  const { body, error: bodyError, retry: retryBody } = useMessageBody(shown)

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const folderByKey = useMemo(
    () => new Map(folders.map((f) => [`${f.accountId}|${f.path}`, f])),
    [folders]
  )

  const unreadByAccount = useMemo(() => {
    const map = new Map<string, number>()
    for (const folder of folders) {
      if (folder.role !== 'inbox') continue
      map.set(folder.accountId, (map.get(folder.accountId) ?? 0) + folder.unread)
    }
    return map
  }, [folders])

  const unreadTotal = useMemo(
    () => [...unreadByAccount.values()].reduce((sum, n) => sum + n, 0),
    [unreadByAccount]
  )

  const sync = useSyncFeedback(accounts, statuses)
  const theme = useTheme(settings?.theme)
  const viewCounts = useViewCounts()
  /** Unter etwa 1200 px fehlt die Ordnerspalte; der Titel über der Liste öffnet die Ordner als Menü. */
  const narrow = useMediaQuery('(max-width: 1199.98px)')
  /** Ein hohes Fenster hat Platz für alle Kontogruppen; ein niedriges öffnet anfangs nur die ersten zwei. */
  const tall = useMediaQuery('(min-height: 1000px)')

  /*
    Auf- und zugeklappte Gruppen der Ordnerspalte. Sofort hier, gespeichert in
    den Einstellungen - die Antwort darauf kommt verzögert und darf einen
    schnellen zweiten Klick nicht zurückdrehen.
  */
  const groupsRef = useRef<Record<string, boolean>>({})
  const [groups, setGroups] = useState<Record<string, boolean>>({})
  const groupsLoaded = useRef(false)
  useEffect(() => {
    if (!settings || groupsLoaded.current) return
    groupsLoaded.current = true
    groupsRef.current = { ...settings.folderGroups }
    setGroups(groupsRef.current)
  }, [settings])
  const isGroupOpen = useCallback((key: string, fallback: boolean) => groups[key] ?? fallback, [groups])
  const toggleGroup = useCallback(
    (key: string, open: boolean) => {
      groupsRef.current = { ...groupsRef.current, [key]: open }
      setGroups(groupsRef.current)
      void updateSettings({ folderGroups: groupsRef.current })
    },
    [updateSettings]
  )

  const selectedFolder = shown ? folderByKey.get(`${shown.accountId}|${shown.folder}`) : undefined
  const selectedAccount = shown ? accountsById.get(shown.accountId) : undefined

  /** Worauf sich eine Aktion bezieht: die Mehrfachauswahl, sonst die offene Zeile mit allem darunter. */
  const selection = useMemo(() => {
    if (selectedIds.size > 1) return heads.filter((m) => selectedIds.has(m.id)).flatMap(membersOf)
    return selected ? membersOf(selected) : []
  }, [heads, membersOf, selected, selectedIds])

  /** Aktionen im Lesebereich: steht dort eine einzelne Mail des Verlaufs, trifft es nur sie. */
  const readerTargets = useMemo(
    () => (shown && selected && shown.id !== selected.id ? [shown] : selection),
    [selected, selection, shown]
  )

  /** Wohin sich eine Mail verschieben laesst: wie im Menue der Leiste, nur ohne den eigenen Ordner. */
  const moveTargets = useCallback(
    (accountId: string, currentFolder?: string): Folder[] =>
      moveChoices(foldersByAccount.get(accountId) ?? []).filter((f) => f.path !== currentFolder),
    [foldersByAccount]
  )

  const appRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLElement>(null)
  const [readerZoom, setReaderZoom] = useState(1)
  const zoomSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void window.api.accounts.encryptionAvailable().then(setEncryptionAvailable)
  }, [])

  /*
    Die Vergroesserung des Nachrichteninhalts liegt hier und nicht in den
    Einstellungen, damit ein Raddreh sofort sichtbar wird; gespeichert wird sie
    erst, wenn das Drehen aufhoert - sonst schriebe jede Rastung auf die Platte.
  */
  // Nur beim Start uebernehmen: die gespeicherte Stufe kommt verzoegert zurueck
  // und setzte sonst eine inzwischen weitergedrehte Vergroesserung zurueck.
  const zoomLoaded = useRef(false)
  useEffect(() => {
    if (!settings || zoomLoaded.current) return
    zoomLoaded.current = true
    setReaderZoom(clampZoom(settings.readerZoom))
  }, [settings])

  const stepReaderZoom = useCallback((step: ZoomStep) => {
    setReaderZoom((current) => {
      const next = nextZoom(current, step)
      if (zoomSaveTimer.current) clearTimeout(zoomSaveTimer.current)
      zoomSaveTimer.current = setTimeout(() => {
        void window.api.settings.update({ readerZoom: next })
      }, 600)
      return next
    })
  }, [])

  useEffect(() => window.api.on('menu:readerZoom', (payload) => stepReaderZoom(payload as ZoomStep)), [
    stepReaderZoom
  ])

  useEffect(() => attachZoomKeys(window, stepReaderZoom), [stepReaderZoom])
  // Strg+Mausrad vergroessert die Mail, egal wo der Zeiger steht.
  useEffect(() => attachZoomWheel(window, stepReaderZoom), [stepReaderZoom])

  // Ungelesen-Zaehler am Taskleisten-Symbol nachfuehren.
  useEffect(() => {
    void window.api.setBadge(unreadTotal, drawBadge(unreadTotal))
  }, [unreadTotal])

  // Ansichtswechsel raeumt die Mehrfachauswahl ab - sie bezieht sich auf eine
  // Liste, die es gleich nicht mehr gibt.
  useEffect(() => {
    setSelectedIds(new Set())
    setAnchorId(null)
  }, [effectiveView])

  // Eine neue Auswahl zeigt wieder sich selbst, nicht den zuletzt angesehenen Teil des Verlaufs.
  useEffect(() => setThreadFocusId(null), [selected?.id])

  // Die gemeldete Mail oeffnen, sobald die Liste sie enthaelt.
  useEffect(() => {
    if (!pendingOpenId) return
    const target = messages.find((m) => m.id === pendingOpenId)
    if (!target) return
    setSelected(target)
    setSelectedIds(new Set([target.id]))
    setPendingOpenId(null)
  }, [messages, pendingOpenId])

  // Die Auswahl aktuell halten: nach einem Sync ist das Objekt ein anderes.
  useEffect(() => {
    if (!selected) return
    const fresh = messages.find((m) => m.id === selected.id)
    if (fresh && fresh !== selected) setSelected(fresh)
    else if (!fresh && !loading) setSelected(null)
  }, [messages, selected, loading])

  /*
    Mails, die der Punkt in der Liste eben bewusst auf ungelesen gesetzt hat.
    Steht die Zeile gerade offen, wuerde das Gelesen-Markieren unten sie sonst
    sofort zuruecksetzen. Gilt, bis eine andere Zeile aufgeht.
  */
  const keptUnread = useRef(new Set<string>())
  useEffect(() => {
    keptUnread.current = new Set()
  }, [selected?.id])

  // Gelesen-Markierung mit Verzoegerung: kurzes Antippen soll nichts aendern.
  // Eine geoeffnete Unterhaltung gilt als Ganzes gelesen.
  const autoRead = useMemo(
    () =>
      selectedIds.size > 1
        ? []
        : selection.filter((m) => !m.flags.includes('\\Seen') && !keptUnread.current.has(m.id)),
    [selectedIds, selection]
  )
  const autoReadKey = autoRead.map((m) => m.id).join(' ')
  useEffect(() => {
    if (!autoRead.length || !settings) return
    if (settings.markReadAfterMs < 0) return
    const targets = autoRead
    const timer = setTimeout(() => {
      void markSeen(targets, true)
    }, settings.markReadAfterMs)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReadKey, settings?.markReadAfterMs])

  // Serverseitige Suche anstossen, sobald die Eingabe steht.
  useEffect(() => {
    const text = search.debounced.trim()
    if (text.length < 3) return
    runServerSearch({
      text,
      accountId: view.kind === 'folder' ? view.accountId : undefined,
      folder: view.kind === 'folder' ? view.folder : undefined
    })
  }, [search.debounced, view])

  const toastMs = useRef(4000)
  const showToast = useCallback((text: string, action?: Toast['action'], ms = 4000, done = false) => {
    // Ohne das raeumte der Zaehler einer aelteren Meldung die neue vorzeitig ab.
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastMs.current = ms
    setToast({ text, action, done })
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }, [])
  /** Solange der Zeiger oder der Fokus auf der Meldung steht, bleibt sie. */
  const holdToast = useCallback((hold: boolean) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = hold ? null : setTimeout(() => setToast(null), Math.min(toastMs.current, 3000))
  }, [])

  /** Fuehrt eine Aktion aus; scheitert sie, sagt eine Meldung warum, und `undo` nimmt ihre Vorschau zurueck. */
  const act = useCallback(
    async (fn: () => Promise<void>, failureText: string, undo?: () => void) => {
      try {
        await fn()
      } catch (err) {
        undo?.()
        showToast(`${failureText} ${(err as Error).message}`)
      }
    },
    [showToast]
  )

  // ------------------------------------------------------------ Auswahl

  /**
   * Strg+Klick und das Kästchen einer Zeile: nimmt sie in die Auswahl oder
   * heraus. Geht die offene Zeile, rückt eine andere angehakte nach - die
   * offene gehört immer zur Auswahl.
   */
  const togglePick = useCallback(
    (message: MessageSummary) => {
      const next = new Set(selectedIds)
      if (next.has(message.id) && next.size > 1) {
        next.delete(message.id)
        setSelected(heads.find((m) => next.has(m.id)) ?? message)
      } else {
        next.add(message.id)
        setSelected(message)
      }
      setSelectedIds(next)
      setAnchorId(message.id)
    },
    [heads, selectedIds]
  )

  const handleSelect = useCallback(
    (message: MessageSummary, event: React.MouseEvent) => {
      if (event.shiftKey && anchorId) {
        const from = heads.findIndex((m) => m.id === anchorId)
        const to = heads.findIndex((m) => m.id === message.id)
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from]
          setSelectedIds(new Set(heads.slice(start, end + 1).map((m) => m.id)))
          setSelected(message)
          return
        }
      }

      if (event.ctrlKey || event.metaKey) {
        togglePick(message)
        return
      }

      setSelectedIds(new Set([message.id]))
      setSelected(message)
      setAnchorId(message.id)
    },
    [anchorId, heads, togglePick]
  )


  const selectNextAfterRemoval = useCallback(
    (removed: MessageSummary[]) => {
      const ids = new Set(removed.map((m) => m.id))
      // Eine Zeile ist weg, sobald eine ihrer Mails geht - Aktionen treffen die ganze Zeile.
      const gone = (head: MessageSummary): boolean => membersOf(head).some((m) => ids.has(m.id))
      const index = heads.findIndex(gone)
      const next = heads.slice(index + 1).find((m) => !gone(m)) ?? null
      const previous = [...heads.slice(0, Math.max(index, 0))].reverse().find((m) => !gone(m)) ?? null
      const target = next ?? previous
      setSelected(target)
      setSelectedIds(target ? new Set([target.id]) : new Set())
      setAnchorId(target?.id ?? null)
    },
    [heads, membersOf]
  )

  // ------------------------------------------------------------ Aktionen

  /** Neue Nachricht aus einem mailto:-Link, mit dem ersten Konto als Absender. */
  const composeFromMailto = useCallback(
    (draft: MailtoDraft) => {
      const account = accounts[0]
      if (!account) {
        showToast('Richte zuerst ein Konto ein.')
        return
      }
      openCompose({
        mode: 'new',
        accountId: account.id,
        to: draft.to.map((address) => ({ address })),
        cc: draft.cc.map((address) => ({ address })),
        bcc: draft.bcc.map((address) => ({ address })),
        subject: draft.subject,
        quotedHtml: '',
        bodyHtml: draft.body ? textToEditorHtml(draft.body) : undefined,
        external: true
      })
    },
    [accounts, showToast]
  )

  // Wurde die App ueber einen mailto:-Link gestartet, kommt er hier an, sobald es Konten gibt.
  const mailtoTaken = useRef(false)
  useEffect(() => {
    if (mailtoTaken.current || !accounts.length) return
    mailtoTaken.current = true
    void window.api.takeMailto().then((draft) => draft && composeFromMailto(draft))
  }, [accounts, composeFromMailto])

  /**
   * Ein neues Verfassen-Fenster. Antwort und Weiterleitung zitieren `source`,
   * den Text der Mail; ohne Angabe den im Lesebereich.
   */
  const startCompose = useCallback(
    (mode: ComposeMode, message?: MessageSummary | null, to?: string, source?: MessageBody | null) => {
      const account = message ? accountsById.get(message.accountId) : accounts[0]
      if (!account) {
        showToast('Richte zuerst ein Konto ein.')
        return
      }
      if (!message || mode === 'new') {
        openCompose({
          mode: 'new',
          accountId: account.id,
          to: to ? [{ address: to }] : [],
          cc: [],
          subject: '',
          quotedHtml: ''
        })
        return
      }

      const text = source === undefined ? body : source
      const quoted = buildQuote(message, text?.html ?? (text?.text ? textToEditorHtml(text.text) : ''))
      if (mode === 'forward') {
        openCompose({
          mode,
          accountId: account.id,
          to: [],
          cc: [],
          subject: prefixSubject(message.subject, 'Fwd: '),
          quotedHtml: quoted
        })
        return
      }

      const replyTo = message.replyTo.length ? message.replyTo : message.from
      const others =
        mode === 'replyAll'
          ? [...message.to, ...message.cc].filter(
              (a) =>
                a.address.toLowerCase() !== account.email.toLowerCase() &&
                !replyTo.some((r) => r.address.toLowerCase() === a.address.toLowerCase())
            )
          : []

      openCompose({
        mode,
        accountId: account.id,
        to: replyTo,
        cc: others,
        subject: prefixSubject(message.subject, 'Re: '),
        quotedHtml: quoted,
        inReplyTo: message.messageId,
        references: [...(message.references ?? []), message.messageId].filter(Boolean) as string[]
      })
    },
    [accounts, accountsById, body, showToast]
  )

  const doArchive = useCallback(
    (items: MessageSummary[]) => {
      if (!items.length) return
      selectNextAfterRemoval(items)
      void act(() => window.api.messages.archive(items), 'Archivieren fehlgeschlagen:')
    },
    [act, selectNextAfterRemoval]
  )

  /**
   * Ein Briefchen je Konto fliegt von der ersten sichtbaren Zeile zum
   * Papierkorb des Kontos - nur fuer Mails, die wirklich dorthin gehen, und
   * nur, wenn Zeile und Papierkorb gerade zu sehen sind.
   */
  const flyToAccountTrash = useCallback(
    (items: MessageSummary[], spot: 'del' | 'date'): boolean => {
      let flew = false
      const byAccount = new Map<string, MessageSummary[]>()
      for (const m of items) byAccount.set(m.accountId, [...(byAccount.get(m.accountId) ?? []), m])
      for (const [accountId, mails] of byAccount) {
        const trash = (foldersByAccount.get(accountId) ?? []).find((f) => f.role === 'trash')
        const going = trash ? mails.filter((m) => m.folder !== trash.path) : []
        if (!trash || !going.length) continue
        const ids = new Set(going.map((m) => m.id))
        const from = heads
          .filter((head) => membersOf(head).some((m) => ids.has(m.id)))
          .map((head) => rowLaunchPoint(head.id, spot))
          .find((p) => p !== null)
        const target = trashTarget(accountId, trash.path)
        if (from && target) flew = flyToTrash({ from, target, count: going.length }) || flew
      }
      return flew
    },
    [foldersByAccount, heads, membersOf]
  )

  /**
   * Die Zeilen dieser Mails gehen, auf dem Weg in den Papierkorb mit
   * Briefchen. Nur ganze Zeilen klappen zu: geht eine Mail aus einer
   * Unterhaltung, bleibt deren Zeile stehen. Liefert, was sie zurueckholt.
   */
  const leave = useCallback(
    (items: MessageSummary[], toTrash?: 'del' | 'date'): (() => void) => {
      const ids = new Set(items.map((m) => m.id))
      const whole = heads.map(membersOf).filter((members) => members.every((m) => ids.has(m.id)))
      const flew = toTrash ? flyToAccountTrash(items, toTrash) : false
      return leaveRows(whole.flat().map((m) => m.id), toTrash ? 'trash' : 'move', flew)
    },
    [flyToAccountTrash, heads, membersOf]
  )

  /** Entf, das Kontextmenue und die Leiste; `spot` sagt, wo an der Zeile das Briefchen abhebt. */
  const doDelete = useCallback(
    (items: MessageSummary[], spot: 'del' | 'date' = 'date') => {
      if (!items.length) return
      const back = leave(items, spot)
      selectNextAfterRemoval(items)
      void act(() => window.api.messages.remove(items), 'Löschen fehlgeschlagen:', back)
    },
    [act, leave, selectNextAfterRemoval]
  )

  const doMove = useCallback(
    (items: MessageSummary[], target: string) => {
      if (!items.length) return
      selectNextAfterRemoval(items)
      void act(() => window.api.messages.move(items, target), 'Verschieben fehlgeschlagen:')
    },
    [act, selectNextAfterRemoval]
  )

  /** Gezogen wird, was ausgewaehlt ist, wenn die Zeile dazugehoert; sonst nur diese Zeile mit ihrer Unterhaltung. */
  const startRowDrag = useCallback(
    (event: React.DragEvent, message: MessageSummary) => {
      const items =
        selectedIds.size > 1 && selectedIds.has(message.id)
          ? heads.filter((m) => selectedIds.has(m.id)).flatMap(membersOf)
          : membersOf(message)
      startMailDrag(event, items)
    },
    [heads, membersOf, selectedIds]
  )

  /** Verschiebt in einen Ordner, mit Rueckgaengig in der Meldung; `toTrash`: vom roten Bereich einer Zeile. */
  const moveAway = useCallback(
    (items: MessageSummary[], folder: Folder, toTrash?: 'del') => {
      // Was schon dort liegt, bleibt, wo es ist.
      const moving = items.filter((m) => m.folder !== folder.path)
      if (!moving.length) return
      const back = leave(moving, toTrash)
      selectNextAfterRemoval(moving)
      const label = folderLabel(folder.name, folder.role)
      void act(async () => {
        await window.api.messages.move(moving, folder.path)
        showToast(
          `${counted(moving.length, 'Mail', 'Mails')} nach ${label} verschoben`,
          {
            label: 'Rückgängig',
            run: () =>
              void act(async () => {
                const back = await window.api.messages.undoMove(moving, folder.path)
                showToast(
                  back ? `${counted(back, 'Mail', 'Mails')} zurückgeholt` : 'Nichts mehr zum Zurückholen da',
                  undefined,
                  4000,
                  back > 0
                )
              }, 'Zurückholen fehlgeschlagen:')
          },
          6000,
          true
        )
      }, 'Verschieben fehlgeschlagen:', back)
    },
    [act, leave, selectNextAfterRemoval, showToast]
  )

  const dropMail = useCallback(
    (items: MessageSummary[], accountId: string, folder: Folder) => {
      endMailDrag({ accountId, folder: folder.path })
      moveAway(items, folder)
    },
    [moveAway]
  )

  /** Der Papierkorb an der Zeile: in den Papierkorb, mit Rueckgaengig. */
  const trashRow = useCallback(
    (message: MessageSummary) => {
      const items = membersOf(message)
      const trash = (foldersByAccount.get(message.accountId) ?? []).find((f) => f.role === 'trash')
      if (trash) moveAway(items, trash, 'del')
      else doDelete(items, 'del')
    },
    [doDelete, foldersByAccount, membersOf, moveAway]
  )

  const doSnooze = useCallback(
    (items: MessageSummary[], until: number) => {
      if (!items.length) return
      selectNextAfterRemoval(items)
      void act(() => window.api.messages.snooze(items, until), 'Zurückstellen fehlgeschlagen:')
      showToast(`Zurückgestellt bis ${shortDateTime(until)}.`, {
        label: 'Rückgängig',
        run: () => void window.api.messages.unsnooze(items)
      })
    },
    [act, selectNextAfterRemoval, showToast]
  )

  const askSnooze = useCallback(
    (items: MessageSummary[]) => {
      if (!items.length) return
      setTimeAsk({
        title: 'Zurückstellen bis',
        confirm: 'Zurückstellen',
        onPick: (at) => doSnooze(items, at)
      })
    },
    [doSnooze]
  )

  // ------------------------------------------------------------- Ausgang

  /** Holt eine wartende Nachricht aus dem Ausgang zurueck in den Verfassen-Dialog. */
  const reopenOutbox = useCallback(
    async (outboxId: string) => {
      const draft: OutgoingMessage | null = await window.api.outbox.take(outboxId).catch(() => null)
      if (!draft) {
        showToast('Zu spaet - die Nachricht ist schon unterwegs.')
        return
      }
      setToast(null)
      openCompose({
        mode: 'new',
        accountId: draft.accountId,
        to: draft.to,
        cc: draft.cc,
        subject: draft.subject,
        quotedHtml: '',
        inReplyTo: draft.inReplyTo,
        references: draft.references,
        draft,
        external: true
      })
    },
    [showToast]
  )

  const handleSent = useCallback(
    (result: SendResult) => {
      const id = result.outboxId
      if (result.queued) {
        showToast('Kein Netz. Die Nachricht liegt im Ausgang und geht raus, sobald es wieder geht.')
      } else if (result.scheduled && id && result.sendAt) {
        showToast(
          `Geplant fuer ${shortDateTime(result.sendAt)}. Bis dahin liegt sie im Ausgang.`,
          { label: 'Aendern', run: () => void reopenOutbox(id) },
          8000
        )
      } else if (result.undoable && id && result.sendAt) {
        // Der Knopf bleibt genau so lange stehen, wie sich die Nachricht noch aufhalten laesst.
        showToast(
          'Nachricht wird gesendet.',
          { label: 'Rückgängig', run: () => void reopenOutbox(id) },
          Math.max(result.sendAt - Date.now(), 1000)
        )
      } else {
        showToast('Gesendet.')
      }
    },
    [reopenOutbox, showToast]
  )

  // ------------------------------------------------------- Kontextmenues

  const openMenu = (event: React.MouseEvent, items: MenuItem[]): void => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, items })
  }

  const messageMenu = useCallback(
    (event: React.MouseEvent, message: MessageSummary) => {
      // Innerhalb der Mehrfachauswahl bezieht sich das Menue auf alles Markierte.
      // Sonst nur auf diese Zeile - geoeffnet wird sie dabei nicht: ein
      // Rechtsklick soll etwa "ungelesen" setzen koennen, ohne dass das Oeffnen
      // sie gleich wieder als gelesen markiert.
      const many = selectedIds.has(message.id) && selectedIds.size > 1
      const items = many ? heads.filter((m) => selectedIds.has(m.id)).flatMap(membersOf) : membersOf(message)
      if (!many) setMenuRowId(message.id)
      const waiting = items.filter((m) => m.snoozedUntil !== undefined && !m.snoozeOver)
      const anyUnread = items.some((m) => !m.flags.includes('\\Seen'))
      const anyUnflagged = items.some((m) => !m.flags.includes('\\Flagged'))
      const sender = message.from[0]?.address
      const targets = moveTargets(message.accountId, message.folder)
      const sameAccount = items.every((m) => m.accountId === message.accountId)

      const menuItems: MenuItem[] = [
        {
          kind: 'item',
          label: 'Antworten',
          icon: <IconReply size={15} />,
          hint: 'R',
          disabled: many,
          onSelect: () => startCompose('reply', message)
        },
        {
          kind: 'item',
          label: 'Allen antworten',
          icon: <IconReplyAll size={15} />,
          hint: 'A',
          disabled: many,
          onSelect: () => startCompose('replyAll', message)
        },
        {
          kind: 'item',
          label: 'Weiterleiten',
          icon: <IconForward size={15} />,
          hint: 'F',
          disabled: many,
          onSelect: () => startCompose('forward', message)
        },
        { kind: 'separator' },
        {
          kind: 'item',
          label: anyUnread ? 'Als gelesen markieren' : 'Als ungelesen markieren',
          icon: <IconEnvelopeOpen size={15} />,
          hint: 'U',
          onSelect: () => void markSeen(items, anyUnread)
        },
        {
          kind: 'item',
          label: anyUnflagged ? 'Markieren' : 'Markierung entfernen',
          icon: <IconStar size={15} />,
          hint: 'S',
          onSelect: () => void window.api.messages.setFlagged(items, anyUnflagged)
        },
        {
          kind: 'submenu',
          label: 'Zurückstellen',
          icon: <IconClock size={15} />,
          items: [
            ...timePresets().map((preset) => ({
              kind: 'item' as const,
              label: preset.label,
              onSelect: () => doSnooze(items, preset.at)
            })),
            { kind: 'item' as const, label: 'Zeitpunkt wählen …', onSelect: () => askSnooze(items) }
          ]
        },
        ...(waiting.length
          ? [
              {
                kind: 'item' as const,
                label: 'Zurückstellung aufheben',
                onSelect: () => void window.api.messages.unsnooze(waiting)
              }
            ]
          : []),
        { kind: 'separator' },
        {
          kind: 'submenu',
          label: many && !sameAccount ? 'Verschieben (nur je Konto)' : 'Verschieben nach',
          icon: <IconFolder size={15} />,
          disabled: !sameAccount,
          items: targets.map((folder) => ({
            kind: 'item' as const,
            label: folderLabel(folder.name, folder.role),
            onSelect: () => doMove(items, folder.path)
          }))
        },
        {
          kind: 'item',
          label: 'Archivieren',
          icon: <IconArchive size={15} />,
          hint: 'E',
          onSelect: () => doArchive(items)
        },
        {
          kind: 'item',
          label: items.length > 1 ? `${items.length} in den Papierkorb` : 'In den Papierkorb',
          icon: <IconTrash size={15} />,
          hint: 'Entf',
          danger: true,
          onSelect: () => doDelete(items)
        }
      ]

      if (sender && !many) {
        menuItems.push(
          { kind: 'separator' },
          {
            kind: 'item',
            label: 'Absenderadresse kopieren',
            onSelect: () => {
              void window.api.copyToClipboard(sender)
              showToast(`${sender} kopiert.`)
            }
          },
          {
            kind: 'item',
            label: 'Neue Nachricht an diesen Absender',
            icon: <IconCompose size={15} />,
            onSelect: () => startCompose('new', null, sender)
          }
        )
      }

      openMenu(event, menuItems)
    },
    [
      askSnooze,
      markSeen,
      doArchive,
      doDelete,
      doMove,
      doSnooze,
      heads,
      membersOf,
      moveTargets,
      selectedIds,
      showToast,
      startCompose
    ]
  )

  const folderMenu = useCallback(
    (event: React.MouseEvent, accountId: string, folder: Folder) => {
      const account = accountsById.get(accountId)
      const items: MenuItem[] = [
        {
          kind: 'item',
          label: 'Alle als gelesen markieren',
          icon: <IconEnvelopeOpen size={15} />,
          disabled: folder.unread === 0,
          onSelect: () => {
            void act(
              () => window.api.messages.markRead({ accountId, folder: folder.path }),
              'Markieren fehlgeschlagen:'
            )
          }
        },
        {
          kind: 'item',
          label: 'Diesen Ordner abrufen',
          icon: <IconRefresh size={15} />,
          onSelect: () => void window.api.sync.refresh(accountId, folder.path)
        }
      ]

      if (folder.role === 'trash' || folder.role === 'junk') {
        items.push(
          { kind: 'separator' },
          {
            kind: 'item',
            label: folder.role === 'trash' ? 'Papierkorb leeren' : 'Spam-Ordner leeren',
            icon: <IconTrash size={15} />,
            danger: true,
            disabled: folder.total === 0,
            onSelect: () => {
              const label = folder.role === 'trash' ? 'Papierkorb' : 'Spam-Ordner'
              if (!window.confirm(`${label} von ${account?.label ?? 'diesem Konto'} endgültig leeren? Das lässt sich nicht rückgängig machen.`)) return
              setSelected(null)
              setSelectedIds(new Set())
              void act(
                () => window.api.messages.emptyFolder(accountId, folder.path),
                'Leeren fehlgeschlagen:'
              )
            }
          }
        )
      }

      openMenu(event, items)
    },
    [accountsById, act]
  )

  const accountMenu = useCallback(
    (event: React.MouseEvent, accountId: string) => {
      const account = accountsById.get(accountId)
      if (!account) return
      const unread = unreadByAccount.get(accountId) ?? 0

      openMenu(event, [
        {
          kind: 'item',
          label: 'Alles als gelesen markieren',
          icon: <IconEnvelopeOpen size={15} />,
          disabled: unread === 0,
          onSelect: () =>
            void act(() => window.api.messages.markRead({ accountId }), 'Markieren fehlgeschlagen:')
        },
        {
          kind: 'item',
          label: 'Dieses Konto abrufen',
          icon: <IconRefresh size={15} />,
          onSelect: () => void window.api.sync.refresh(accountId)
        },
        {
          kind: 'item',
          label: 'Neue Nachricht von diesem Konto',
          icon: <IconCompose size={15} />,
          onSelect: () =>
            openCompose({
              mode: 'new',
              accountId,
              to: [],
              cc: [],
              subject: '',
              quotedHtml: ''
            })
        },
        { kind: 'separator' },
        {
          kind: 'item',
          label: 'Konto bearbeiten',
          icon: <IconSettings size={15} />,
          onSelect: () => setWizard({ account })
        },
        {
          kind: 'item',
          label: 'Konto entfernen',
          icon: <IconTrash size={15} />,
          danger: true,
          onSelect: () => {
            if (!window.confirm(`${account.label} entfernen? Die lokale Kopie wird gelöscht, auf dem Server bleibt alles unverändert.`)) return
            void window.api.accounts.remove(accountId)
            setView(UNIFIED_INBOX)
            setSelected(null)
            setSelectedIds(new Set())
          }
        }
      ])
    },
    [accountsById, act, unreadByAccount]
  )

  const unifiedMenu = useCallback(
    (event: React.MouseEvent) => {
      openMenu(event, [
        {
          kind: 'item',
          label: 'Alles in allen Konten als gelesen markieren',
          icon: <IconInbox size={15} />,
          disabled: unreadTotal === 0,
          onSelect: () => {
            if (!window.confirm(`${unreadTotal} ungelesene Nachrichten in allen Konten als gelesen markieren?`)) return
            void act(() => window.api.messages.markRead({}), 'Markieren fehlgeschlagen:')
          }
        },
        {
          kind: 'item',
          label: 'Alle Konten abrufen',
          icon: <IconRefresh size={15} />,
          onSelect: () => void window.api.sync.refresh()
        }
      ])
    },
    [act, unreadTotal]
  )

  /** Ein Entwurf aus dem Entwuerfe-Ordner zurueck ins Verfassen-Fenster. */
  const continueDraft = useCallback(
    async (message: MessageSummary) => {
      try {
        const { ref, message: draft } = await window.api.drafts.open(message.accountId, message.folder, message.uid)
        openCompose({
          mode: 'new',
          accountId: draft.accountId,
          to: draft.to,
          cc: draft.cc,
          bcc: draft.bcc,
          subject: draft.subject,
          quotedHtml: '',
          inReplyTo: draft.inReplyTo,
          references: draft.references,
          draft,
          draftRef: ref
        })
      } catch (err) {
        const kind = draftFailureOf((err as Error).message)
        showToast(`Der Entwurf ließ sich nicht öffnen. ${draftFailureSentence(kind, accountsById.get(message.accountId)?.label ?? 'Das Konto')}`)
      }
    },
    [openCompose, showToast]
  )

  const isDraft = (message: MessageSummary | null): boolean =>
    Boolean(message && folderByKey.get(`${message.accountId}|${message.folder}`)?.role === 'drafts')

  /** Doppelklick in der Liste: die Mail im eigenen Fenster, ein Entwurf zum Weiterschreiben. */
  const openMessage = (message: MessageSummary): void => {
    if (isDraft(message)) void continueDraft(message)
    else void wins.openMail(message)
  }

  const saveAllAttachments = (message: MessageSummary): void => {
    void window.api.attachments.saveAll(message.accountId, message.folder, message.uid).then((result) => {
      if (result.error) showToast(result.error)
      else if (result.saved) showToast(`${result.saved} Anhänge gespeichert in ${result.path}.`)
    })
  }

  const trustDomain = (domain: string): void => {
    void workspace.updateSettings({ remoteImageDomains: addTrustedDomain(settings?.remoteImageDomains ?? [], domain) })
    showToast(`Bilder von ${domain} werden ab jetzt immer geladen.`)
  }

  // ------------------------------------------------------- Tastaturkuerzel

  useEffect(() => {
    const off = [
      window.api.on('menu:compose', () => startCompose('new')),
      window.api.on('compose:mailto', (payload) => composeFromMailto(payload as MailtoDraft)),
      window.api.on('menu:refresh', () => void window.api.sync.refresh()),
      window.api.on('menu:settings', () => setShowSettings(true)),
      window.api.on('menu:search', () => searchInputRef.current?.focus()),
      // Klick auf eine Benachrichtigung: in den Sammelposteingang und die
      // gemeldete Mail vormerken - sie taucht auf, sobald die Liste steht.
      window.api.on('mail:open', (payload) => {
        setView(UNIFIED_INBOX)
        search.setText('')
        setPendingOpenId(typeof payload === 'string' ? payload : null)
      }),
      // Eine wartende Nachricht wurde beim Versand endgueltig abgelehnt.
      window.api.on('mail:sendFailed', (payload) => {
        const { subject, error } = (payload ?? {}) as { subject?: string; error?: string }
        showToast(
          `Senden fehlgeschlagen: ${subject || '(kein Betreff)'}. ${error ?? ''} Die Nachricht liegt im Ausgang.`,
          { label: 'Ausgang', run: () => setShowSettings(true) },
          12000
        )
      })
    ]
    return () => off.forEach((fn) => fn())
  }, [startCompose, composeFromMailto, search, showToast])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement
      const typing =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      if (typing || wins.expandedId || wizard || showSettings || menu || timeAsk) return

      const index = selected ? heads.findIndex((m) => membersOf(m).some((x) => x.id === selected.id)) : -1
      const step = (next: MessageSummary | undefined): void => {
        if (!next) return
        event.preventDefault()
        setSelected(next)
        setSelectedIds(new Set([next.id]))
        setAnchorId(next.id)
      }

      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          step(heads[Math.min(index + 1, heads.length - 1)] ?? heads[0])
          break
        case 'k':
        case 'ArrowUp':
          if (index > 0) step(heads[index - 1])
          break
        case 'a':
          if ((event.ctrlKey || event.metaKey) && heads.length) {
            event.preventDefault()
            setSelectedIds(new Set(heads.map((m) => m.id)))
            break
          }
          if (shown) {
            event.preventDefault()
            startCompose('replyAll', shown)
          }
          break
        case 'r':
          if (shown) {
            event.preventDefault()
            startCompose('reply', shown)
          }
          break
        case 'f':
          if (shown) {
            event.preventDefault()
            startCompose('forward', shown)
          }
          break
        case 'b':
          if (selection.length) {
            event.preventDefault()
            askSnooze(selection)
          }
          break
        case 'e':
          if (selection.length) {
            event.preventDefault()
            doArchive(selection)
          }
          break
        case 'Delete':
          if (selection.length) {
            event.preventDefault()
            doDelete(selection)
          }
          break
        case 's':
          if (selection.length) {
            event.preventDefault()
            const anyUnflagged = selection.some((m) => !m.flags.includes('\\Flagged'))
            void window.api.messages.setFlagged(selection, anyUnflagged)
          }
          break
        case 'u':
          if (selection.length) {
            event.preventDefault()
            void markSeen(selection, false)
            setSelected(null)
          }
          break
        case 'Escape':
          if (selectedIds.size > 1 && selected) {
            event.preventDefault()
            setSelectedIds(new Set([selected.id]))
          }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    askSnooze,
    markSeen,
    wins.expandedId,
    doArchive,
    doDelete,
    heads,
    membersOf,
    menu,
    selected,
    selectedIds,
    selection,
    showSettings,
    shown,
    startCompose,
    timeAsk,
    wizard
  ])

  // ------------------------------------------------------------- Rendern

  if (!workspace.ready || !settings) return null

  if (!accounts.length) {
    return (
      <>
        <Welcome onAdd={() => setWizard({})} />
        {wizard && (
          <AccountWizard
            usedColors={[]}
            encryptionAvailable={encryptionAvailable}
            onClose={() => setWizard(null)}
            onSaved={() => {
              setWizard(null)
              showToast('Konto verbunden. Die Nachrichten werden jetzt geladen.')
            }}
          />
        )}
      </>
    )
  }

  const scopeAccountId =
    view.kind === 'folder' ? view.accountId : view.kind === 'search' ? view.query.accountId : undefined

  // Die Unterzeile über der Liste: was gezeigt wird, und wie viel davon.
  const info = viewInfo(view, accountsById, folderByKey)
  const searching = effectiveView.kind === 'search'
  const selecting = selectedIds.size > 1
  const place = info.account ? `${inPlace(info.title, info.folder?.role)} · ${info.account.label}` : 'in allen Konten und Ordnern'
  let subTitle = info.title
  let subMeta: string
  if (selecting) {
    subTitle = `${selectedIds.size} ausgewählt`
    subMeta = `von ${rows.length} ${searching ? 'Treffern' : inPlace(info.title, info.folder?.role)}`
  } else if (searching) {
    subTitle = loading ? 'Sucht …' : rows.length ? counted(rows.length, 'Treffer', 'Treffer') : 'Keine Treffer'
    subMeta = place
  } else if (view.kind === 'folder') {
    // In Entwürfe zählt nicht, was ungelesen ist, sondern wie viele es gibt.
    const drafts = info.folder?.role === 'drafts'
    const unread = info.folder && !drafts ? info.folder.unread : 0
    const amount = drafts ? (!loading && rows.length ? counted(rows.length, 'Entwurf', 'Entwürfe') : '') : unread ? `${unread} ungelesen` : ''
    subMeta = [info.account?.label ?? '', amount].filter(Boolean).join(' · ')
  } else {
    const byUnread = view.kind === 'unified' && (view.id === 'inbox' || view.id === 'unread')
    const amount = byUnread ? (unreadTotal ? `${unreadTotal} ungelesen` : '') : !loading && rows.length ? String(rows.length) : ''
    subMeta = ['Alle Konten', amount].filter(Boolean).join(' · ')
  }
  const searchScope = info.account
    ? `Sucht ${inPlace(info.title, info.folder?.role)} von ${info.account.label}, auch auf dem Server`
    : 'Sucht in allen Konten, auch auf dem Server'

  const treeProps = {
    accounts,
    foldersByAccount,
    statusById,
    unreadTotal,
    unreadByAccount,
    viewCounts,
    view,
    scopeAccountId,
    theme,
    isOpen: isGroupOpen,
    onToggle: toggleGroup,
    onSelect: setView,
    onFolderContextMenu: folderMenu,
    onAccountContextMenu: accountMenu,
    openGroups: tall ? Infinity : 2,
    onDropMail: dropMail
  }

  const bottom = settings.previewPosition === 'bottom'

  return (
    <div className="vf" data-dock={dock || undefined}>
      <div className="vf-main">
      <div
        className="app"
        ref={appRef}
        data-preview={settings.previewPosition}
        data-folders={narrow ? 'hidden' : 'shown'}
        style={
          {
            ...(settings.listWidth ? { '--list-w': `${settings.listWidth}px` } : {}),
            ...(settings.listHeight ? { '--list-h': `${settings.listHeight}px` } : {})
          } as React.CSSProperties
        }
      >
        <AccountRail
          accounts={accounts}
          statusById={statusById}
          unreadByAccount={unreadByAccount}
          unreadTotal={unreadTotal}
          view={view}
          theme={theme}
          onSelectUnified={() => setView(UNIFIED_INBOX)}
          onSelectAccount={(accountId) => {
            const inbox = (foldersByAccount.get(accountId) ?? []).find((f) => f.role === 'inbox')
            setView(
              inbox
                ? { kind: 'folder', accountId, folder: inbox.path }
                : { kind: 'folder', accountId, folder: 'INBOX' }
            )
          }}
          onAccountContextMenu={accountMenu}
          onUnifiedContextMenu={unifiedMenu}
          onCompose={() => startCompose('new')}
          onAddAccount={() => setWizard({})}
          onSettings={() => setShowSettings(true)}
        />

        {!narrow && <FolderColumn {...treeProps} />}

        <MessageList
          rows={rows}
          threaded={threaded}
          loading={loading}
          view={effectiveView}
          accountsById={accountsById}
          folderByKey={folderByKey}
          settings={settings}
          selectedId={selected?.id ?? null}
          menuRowId={menuRowId}
          selectedIds={selectedIds}
          searchText={search.text}
          searchScope={searchScope}
          sync={sync}
          title={
            narrow && !selecting && !searching ? (
              <FolderMenu {...treeProps} title={info.title} icon={info.icon} />
            ) : (
              subTitle
            )
          }
          meta={subMeta}
          subAction={
            selecting && selectedIds.size < heads.length ? (
              <button
                type="button"
                className="rv-btn rv-btn--s lv-all"
                title="Alle auswählen · Strg+A"
                onClick={() => setSelectedIds(new Set(heads.map((m) => m.id)))}
              >
                Alle auswählen
              </button>
            ) : selecting ? (
              false
            ) : undefined
          }
          searchInputRef={searchInputRef}
          listRef={listRef}
          onSearchChange={search.setText}
          onSelect={handleSelect}
          onOpen={openMessage}
          onTogglePick={togglePick}
          onContextMenu={messageMenu}
          onDragStart={startRowDrag}
          onTrash={trashRow}
          onToggleRead={(message) => {
            const members = membersOf(message)
            const seen = members.some((m) => !m.flags.includes('\\Seen'))
            for (const m of members) {
              if (seen) keptUnread.current.delete(m.id)
              else keptUnread.current.add(m.id)
            }
            void markSeen(members, seen)
          }}
          onRefresh={() => void window.api.sync.refresh()}
          onCompose={() => startCompose('new')}
          resizer={
            <Splitter
              axis={bottom ? 'y' : 'x'}
              min={bottom ? 140 : 280}
              max={() => {
                const app = appRef.current
                const list = listRef.current?.getBoundingClientRect()
                if (!app || !list) return 800
                // Dem Lesebereich bleibt immer genug Platz zum Lesen.
                return bottom ? app.clientHeight - 200 : app.getBoundingClientRect().right - list.left - 420
              }}
              onLive={(size) => appRef.current?.style.setProperty(bottom ? '--list-h' : '--list-w', `${size}px`)}
              onCommit={(size) => void updateSettings(bottom ? { listHeight: size } : { listWidth: size })}
              onReset={() => {
                // 0 heißt: die Größe, die zum Fenster passt (unten halbe-halbe, rechts 384 oder 440 px).
                appRef.current?.style.removeProperty(bottom ? '--list-h' : '--list-w')
                void updateSettings(bottom ? { listHeight: 0 } : { listWidth: 0 })
              }}
            />
          }
        />

        {selecting ? (
          <SelectionPane
            heads={heads.filter((m) => selectedIds.has(m.id))}
            members={selection}
            total={heads.length}
            accountsById={accountsById}
            folderByKey={folderByKey}
            foldersByAccount={foldersByAccount}
            theme={theme}
            onMarkRead={() => void markSeen(selection, true)}
            onMarkUnread={() => void markSeen(selection, false)}
            onToggleFlag={(flag) => void window.api.messages.setFlagged(selection, flag)}
            onSnooze={(until) => doSnooze(selection, until)}
            onAskSnooze={() => askSnooze(selection)}
            onMove={(path) => doMove(selection, path)}
            onArchive={() => doArchive(selection)}
            onDelete={() => doDelete(selection)}
          />
        ) : (
          <Reader
            message={shown}
            thread={thread}
            threadFolderTag={(m) => {
              const folder = folderByKey.get(`${m.accountId}|${m.folder}`)
              if (folder?.role === 'inbox') return null
              return folder ? folderLabel(folder.name, folder.role) : m.folder
            }}
            onOpenThreadMessage={(m) => setThreadFocusId(m.id === selected?.id ? null : m.id)}
            onSnooze={(until) => doSnooze(readerTargets, until)}
            onAskSnooze={() => askSnooze(readerTargets)}
            onUnsnooze={() => void window.api.messages.unsnooze(readerTargets)}
            body={body}
            error={bodyError}
            onRetry={retryBody}
            account={selectedAccount}
            folder={selectedFolder}
            folders={shown ? (foldersByAccount.get(shown.accountId) ?? []) : []}
            loadRemoteByDefault={settings.loadRemoteImages}
            trustedDomains={settings.remoteImageDomains}
            zoom={readerZoom}
            onZoomStep={stepReaderZoom}
            onReply={() => startCompose('reply', shown)}
            onContinueDraft={shown && isDraft(shown) ? () => void continueDraft(shown) : undefined}
            onReplyAll={() => startCompose('replyAll', shown)}
            onForward={() => startCompose('forward', shown)}
            onArchive={() => doArchive(readerTargets)}
            onDelete={() => doDelete(readerTargets)}
            onToggleFlag={() =>
              shown && void window.api.messages.setFlagged([shown], !shown.flags.includes('\\Flagged'))
            }
            onMarkUnread={() => {
              if (!shown) return
              void markSeen([shown], false)
              setSelected(null)
            }}
            onMove={(path) => doMove(readerTargets, path)}
            onSaveAllAttachments={() => shown && saveAllAttachments(shown)}
            onTrustDomain={trustDomain}
          />
        )}
      </div>

      {wins.windows.length > 0 && (
        // Klick daneben legt das Fenster in die Leiste; die Leiste selbst liegt nicht darunter.
        <div
          className="scrim"
          aria-hidden="true"
          data-on={wins.expandedId ? '' : undefined}
          onMouseDown={() => void wins.minimize()}
        />
      )}
      {wins.windows.map((w) =>
        w.kind === 'mail' ? (
          <MailWindow
            key={w.id}
            windowId={w.id}
            message={w.message}
            expanded={w.id === wins.expandedId}
            leaving={Boolean(w.leaving)}
            ownAddress={accountsById.get(w.message.accountId)?.email}
            loadRemoteByDefault={settings.loadRemoteImages}
            trustedDomains={settings.remoteImageDomains}
            zoom={readerZoom}
            onZoomStep={stepReaderZoom}
            onTrustDomain={trustDomain}
            onSaveAllAttachments={() => saveAllAttachments(w.message)}
            onMinimize={() => void wins.minimize()}
            onClose={() => wins.closeWindow(w.id)}
            onReply={(text) => startCompose('reply', w.message, undefined, text)}
            onForward={(text) => startCompose('forward', w.message, undefined, text)}
            onDelete={() => {
              wins.closeWindow(w.id)
              doDelete([w.message])
            }}
          />
        ) : (
        <Composer
          key={w.id}
          windowId={w.id}
          accounts={accounts}
          seed={w.seed}
          templates={settings.templates}
          expanded={w.id === wins.expandedId}
          leaving={Boolean(w.leaving)}
          onMinimize={() => void wins.minimize()}
          onClosed={() => wins.closeWindow(w.id)}
          onSent={(result) => {
            wins.closeWindow(w.id)
            handleSent(result)
          }}
          onTitle={(title) => wins.patch(w.id, { title })}
          onSaveFailed={(failed) => wins.patch(w.id, { failed })}
          onSaved={(draftRef) => wins.patch(w.id, { draftRef })}
          register={wins.register}
        />
        )
      )}
      </div>

      {dock && (
        <WindowBar
          tabs={openTabs}
          expandedId={wins.expandedId}
          leaving={dock === 'leaving'}
          onToggle={(id) => void wins.toggle(id)}
          onClose={(id) => void wins.closeFromBar(id)}
        />
      )}

      {menu && <ContextMenu request={menu} onClose={() => setMenu(null)} />}

      {timeAsk && (
        <TimeDialog
          title={timeAsk.title}
          confirm={timeAsk.confirm}
          onPick={timeAsk.onPick}
          onClose={() => setTimeAsk(null)}
        />
      )}

      {wizard && (
        <AccountWizard
          account={wizard.account}
          usedColors={accounts.map((a) => a.color)}
          encryptionAvailable={encryptionAvailable}
          onClose={() => setWizard(null)}
          onSaved={() => {
            setWizard(null)
            showToast(wizard.account ? 'Konto aktualisiert.' : 'Konto verbunden.')
          }}
        />
      )}

      {showSettings && (
        <SettingsDialog
          accounts={accounts}
          statusById={statusById}
          settings={settings}
          outbox={workspace.outbox}
          onEditOutbox={(id) => {
            setShowSettings(false)
            void reopenOutbox(id)
          }}
          onClose={() => setShowSettings(false)}
          folders={folders}
          onUpdate={(patch) => void workspace.updateSettings(patch)}
          onEditAccount={(account) => {
            setShowSettings(false)
            setWizard({ account })
          }}
          onAddAccount={() => {
            setShowSettings(false)
            setWizard({})
          }}
          onRemoveAccount={(account) => {
            void window.api.accounts.remove(account.id)
            if (scopeAccountId === account.id) setView(UNIFIED_INBOX)
            setSelected(null)
          }}
        />
      )}

      <MailTokens />

      {toast && (
        <div
          className="toast"
          role="status"
          onMouseEnter={() => holdToast(true)}
          onMouseLeave={() => holdToast(false)}
          onFocus={() => holdToast(true)}
          onBlur={() => holdToast(false)}
        >
          {toast.done && <IconCheck size={16} />}
          <span className="toast-text">{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                const run = toast.action?.run
                setToast(null)
                run?.()
              }}
            >
              {toast.action.label === 'Rückgängig' && <IconUndo size={14} />}
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Welcome({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty" style={{ height: '100vh' }}>
      <div className="empty-inner">
        <h2>Noch kein Konto verbunden</h2>
        <p>
          Verbinde dein erstes Postfach. Gmail, iCloud, WEB.DE, GMX und alles andere mit IMAP
          funktionieren; die Servereinstellungen kommen automatisch, sobald du deine Adresse
          einträgst.
        </p>
        <button className="btn btn-primary" onClick={onAdd}>
          Konto hinzufügen
        </button>
      </div>
    </div>
  )
}

function prefixSubject(subject: string, prefix: string): string {
  const clean = subject.replace(/^((re|aw|antw|fwd|wg|fw)\s*(\[\d+\])?:\s*)+/i, '')
  return `${prefix}${clean}`
}

/**
 * Zitat im ueblichen Format. Der Originaltext bleibt HTML - er wurde beim
 * Anzeigen bereits bereinigt und wird beim Senden nur weitergereicht.
 */
function buildQuote(message: MessageSummary, originalHtml: string): string {
  const from = message.from.map(formatAddressFull).join(', ')
  const header = `Am ${fullDate(message.date)} schrieb ${from}:`
  const to = message.to.length ? `<div>An: ${escapeHtml(addressList(message.to, 5))}</div>` : ''
  return `<p></p><div>${escapeHtml(header)}</div>${to}<blockquote>${originalHtml}</blockquote>`
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

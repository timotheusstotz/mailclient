import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Account,
  AccountStatus,
  Folder,
  MessageBody,
  MessageSummary,
  OutboxItem,
  SearchQuery,
  Settings,
  ViewRef
} from '@shared/types'
import type { Theme } from './lib/accountTone'

const api = window.api

/** Konten, Ordner, Status und Einstellungen - alles, was global gilt. */
export function useWorkspace() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [statuses, setStatuses] = useState<AccountStatus[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [outbox, setOutbox] = useState<OutboxItem[]>([])
  const [ready, setReady] = useState(false)

  const reloadAccounts = useCallback(async () => {
    const [list, statusList] = await Promise.all([api.accounts.list(), api.accounts.statuses()])
    setAccounts(list)
    setStatuses(statusList)
  }, [])

  const reloadFolders = useCallback(async () => setFolders(await api.folders.list()), [])
  const reloadOutbox = useCallback(async () => setOutbox(await api.outbox.list()), [])

  useEffect(() => {
    void (async () => {
      setSettings(await api.settings.get())
      await reloadAccounts()
      await reloadFolders()
      await reloadOutbox()
      setReady(true)
    })()

    const off = [
      api.on('accounts:changed', () => void reloadAccounts()),
      api.on('folders:changed', () => void reloadFolders()),
      api.on('status:changed', (payload) => setStatuses(payload as AccountStatus[])),
      api.on('settings:changed', (payload) => setSettings(payload as Settings)),
      api.on('outbox:changed', (payload) => setOutbox(payload as OutboxItem[]))
    ]
    return () => off.forEach((fn) => fn())
  }, [reloadAccounts, reloadFolders, reloadOutbox])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await api.settings.update(patch))
  }, [])

  const foldersByAccount = useMemo(() => {
    const map = new Map<string, Folder[]>()
    for (const folder of folders) {
      const list = map.get(folder.accountId)
      if (list) list.push(folder)
      else map.set(folder.accountId, [folder])
    }
    return map
  }, [folders])

  const statusById = useMemo(() => new Map(statuses.map((s) => [s.accountId, s])), [statuses])

  return {
    accounts,
    folders,
    foldersByAccount,
    statuses,
    statusById,
    settings,
    outbox,
    ready,
    reloadAccounts,
    reloadFolders,
    updateSettings
  }
}

/** Was die Unterzeile der Liste rechts \u00fcber den Abruf sagt. */
export type SyncStatus =
  | { kind: 'idle' | 'busy' | 'done' }
  | {
      kind: 'error'
      /** Kurz: "web.de offline", "web.de: Anmeldung fehlgeschlagen" */
      text: string
      /** Die ganze Meldung des Servers, f\u00fcr den Tooltip */
      detail: string
    }

export interface SyncFeedback {
  status: SyncStatus
  /** L\u00e4uft gerade ein Abruf? Dreht das Symbol am Abruf-Knopf. */
  busy: boolean
  /** "Erneut": die Konten mit Fehler noch einmal abrufen */
  retry: () => void
}

interface Problem {
  phase: 'error' | 'offline'
  message: string
}

/**
 * \u00dcbersetzt die Kontostatus in die Meldung rechts in der Unterzeile der Liste.
 *
 * "Wird abgerufen \u2026", solange ein Konto verbindet oder abgleicht; danach steht
 * "Aktuell" ein paar Sekunden. Ein Fehler bleibt stehen, bis das Konto wieder
 * fertig abgeglichen hat oder der Nutzer "Erneut" dr\u00fcckt - auch w\u00e4hrend die
 * App im Hintergrund neu verbindet, sonst flackerte er bei jedem Versuch weg.
 */
export function useSyncFeedback(accounts: Account[], statuses: AccountStatus[]): SyncFeedback {
  const busy = statuses.some((s) => s.phase === 'syncing' || s.phase === 'connecting')
  const [problems, setProblems] = useState<Map<string, Problem>>(() => new Map())
  /** "Erneut" gedr\u00fcckt, aber noch kein Status zur\u00fcck */
  const [retrying, setRetrying] = useState(false)
  const [done, setDone] = useState(false)
  const wasBusy = useRef(false)

  useEffect(() => {
    setProblems((previous) => {
      const next = new Map(previous)
      for (const s of statuses) {
        if (s.phase === 'error' || s.phase === 'offline') next.set(s.accountId, { phase: s.phase, message: s.message ?? '' })
        else if (s.phase === 'idle') next.delete(s.accountId)
      }
      for (const id of next.keys()) if (!statuses.some((s) => s.accountId === id)) next.delete(id)
      const same =
        next.size === previous.size &&
        [...next].every(([id, p]) => previous.get(id)?.phase === p.phase && previous.get(id)?.message === p.message)
      return same ? previous : next
    })
  }, [statuses])

  useEffect(() => {
    if (busy) {
      wasBusy.current = true
      setRetrying(false)
      setDone(false)
      return
    }
    // Nur ein gerade beendeter Lauf ist eine Nachricht wert.
    if (!wasBusy.current) return
    wasBusy.current = false
    setDone(true)
    const timer = setTimeout(() => setDone(false), 2400)
    return () => clearTimeout(timer)
  }, [busy])

  // Kommt nach "Erneut" gar kein Status, steht der Fehler wieder da.
  useEffect(() => {
    if (!retrying) return
    const timer = setTimeout(() => setRetrying(false), 5000)
    return () => clearTimeout(timer)
  }, [retrying])

  const retry = useCallback(() => {
    const ids = [...problems.keys()]
    setProblems(new Map())
    setRetrying(true)
    for (const id of ids) void api.sync.refresh(id).catch(() => {})
  }, [problems])

  const status = useMemo((): SyncStatus => {
    const first = [...problems].find(([id]) => accounts.some((a) => a.id === id))
    if (first && !retrying) {
      const [id, problem] = first
      const label = accounts.find((a) => a.id === id)?.label ?? 'Konto'
      const text = problems.size > 1 ? `${problems.size} Konten offline` : problemText(label, problem)
      const detail = [...problems]
        .map(([pid, p]) => `${accounts.find((a) => a.id === pid)?.label ?? 'Konto'}: ${p.message || 'Keine Verbindung'}`)
        .join('\n')
      return { kind: 'error', text, detail }
    }
    if (busy || retrying) return { kind: 'busy' }
    return { kind: done ? 'done' : 'idle' }
  }, [accounts, busy, done, problems, retrying])

  return { status, busy: busy || retrying, retry }
}

/** "web.de offline" f\u00fcr Verbindungsprobleme, sonst knapp, was schiefging. */
function problemText(label: string, problem: Problem): string {
  if (/Anmeldung/i.test(problem.message)) return `${label}: Anmeldung fehlgeschlagen`
  if (problem.phase === 'offline' || /Verbindung|Server|Zeit/i.test(problem.message)) return `${label} offline`
  return `${label}: Abruf fehlgeschlagen`
}

/** "light" oder "dark", wie es gerade gilt; "system" folgt dem Betriebssystem. Setzt es aufs Wurzelelement. */
export function useTheme(choice: Settings['theme'] | undefined): Theme {
  const query = '(prefers-color-scheme: dark)'
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = (): void => setSystemDark(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  const theme: Theme = choice === 'dark' || (choice !== 'light' && systemDark) ? 'dark' : 'light'
  useEffect(() => {
    if (choice) document.documentElement.dataset.theme = theme
  }, [choice, theme])
  return theme
}

/** Ob eine Media-Abfrage gerade zutrifft, etwa das schmale Fenster. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = (): void => setMatches(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/**
 * Wie viele Mails unter "Markiert" und "Zur\u00fcckgestellt" stehen, f\u00fcr die Zahlen
 * in der Ordnerspalte. Nach einer \u00c4nderung kurz gewartet: ein Abgleich meldet
 * sich oft mehrmals hintereinander.
 */
export function useViewCounts(): { flagged: number; snoozed: number } {
  const [counts, setCounts] = useState({ flagged: 0, snoozed: 0 })
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    const load = async (): Promise<void> => {
      const [flagged, snoozed] = await Promise.all([
        api.messages.list({ kind: 'unified', id: 'flagged' }),
        api.messages.list({ kind: 'unified', id: 'snoozed' })
      ])
      if (!cancelled) setCounts({ flagged: flagged.length, snoozed: snoozed.length })
    }
    void load().catch(() => {})
    const off = api.on('messages:changed', () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void load().catch(() => {}), 400)
    })
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      off()
    }
  }, [])
  return counts
}

/** Die Nachrichten der aktuellen Ansicht, inklusive Live-Aktualisierung. */
export function useMessages(view: ViewRef) {
  const [messages, setMessages] = useState<MessageSummary[]>([])
  const [loading, setLoading] = useState(true)
  const viewRef = useRef(view)
  viewRef.current = view
  /** Zeitpunkt der letzten Aenderung, die nur hier in der Oberflaeche steht. */
  const patchedAt = useRef(0)

  const reload = useCallback(async () => {
    const startedAt = Date.now()
    const list = await api.messages.list(viewRef.current)
    // Eine Liste, die vor der Aenderung angefragt wurde, kennt sie noch nicht.
    // Die naechste kommt ohnehin: der Main-Prozess meldet die Aenderung selbst.
    if (startedAt < patchedAt.current) return
    setMessages(list)
    setLoading(false)
  }, [])

  /**
   * Zeigt ein gesetztes oder entferntes Flag sofort an. Der Main-Prozess traegt
   * es zwar auch sofort ein, ist waehrend eines grossen Abgleichs aber zu
   * beschaeftigt, um die neue Liste ohne Verzug zu liefern.
   */
  const patchFlags = useCallback((ids: Set<string>, flag: string, on: boolean) => {
    patchedAt.current = Date.now()
    setMessages((list) =>
      list.map((m) => {
        if (!ids.has(m.id) || m.flags.includes(flag) === on) return m
        return { ...m, flags: on ? [...m.flags, flag] : m.flags.filter((f) => f !== flag) }
      })
    )
  }, [])

  useEffect(() => {
    setLoading(true)
    void reload()
    const off = api.on('messages:changed', () => void reload())
    return () => off()
  }, [reload, view])

  return { messages, loading, reload, patchFlags }
}

/**
 * Die Unterhaltung, zu der die ausgewaehlte Nachricht gehoert, aelteste zuerst.
 * Laedt neu, sobald sich am Bestand etwas aendert - der Main-Prozess holt
 * fehlende Teile vom Server nach und meldet das ueber denselben Kanal.
 */
export function useThread(message: MessageSummary | null, enabled: boolean): MessageSummary[] {
  const [thread, setThread] = useState<MessageSummary[]>([])
  const key = enabled && message ? message.id : null
  const ref = useRef(message)
  ref.current = message

  useEffect(() => {
    setThread([])
    if (!key) return
    let cancelled = false
    const load = (): void => {
      const current = ref.current
      if (!current) return
      void api.messages
        .thread(current.accountId, current.folder, current.uid)
        .then((list) => {
          if (!cancelled) setThread(list)
        })
        .catch(() => {})
    }
    load()
    const off = api.on('messages:changed', load)
    return () => {
      cancelled = true
      off()
    }
  }, [key])

  return thread
}

/**
 * Der Textkoerper der ausgewaehlten Nachricht. Ergebnis und Fehler gelten nur
 * fuer die Nachricht, fuer die sie geholt wurden: wechselt sie, ist beides
 * sofort weg - sonst stuende kurz der Text der vorigen Mail unter dem Kopf der
 * neuen. `retry` holt den Koerper nach einem Fehler noch einmal.
 */
export function useMessageBody(message: MessageSummary | null) {
  const [result, setResult] = useState<{ key: string; body: MessageBody | null; error: string | null } | null>(null)
  const [attempt, setAttempt] = useState(0)

  // Die Identitaet haengt an der Kennung, nicht am Objekt: jeder Sync liefert
  // neue Objekte, der Inhalt der Nachricht aendert sich davon aber nicht.
  const key = message?.id ?? null
  const ref = useRef(message)
  ref.current = message

  useEffect(() => {
    const message = ref.current
    setResult(null)
    if (!message) return
    let cancelled = false
    const done = (body: MessageBody | null, error: string | null): void => {
      if (!cancelled) setResult({ key: message.id, body, error })
    }
    void api.messages
      .body(message.accountId, message.folder, message.uid)
      // Der Main-Prozess liefert null, wenn weder Server noch Ablage die Mail haben.
      .then((body) => done(body, body ? null : 'Der Server hat sie nicht geliefert, und hier liegt keine Kopie.'))
      .catch((err: Error) => done(null, err.message))
    return () => {
      cancelled = true
    }
  }, [key, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const current = result && result.key === key ? result : null

  return {
    body: current?.body ?? null,
    error: current?.error ?? null,
    loading: key !== null && !current,
    retry
  }
}

/**
 * Tippen soll die Liste nicht bei jedem Anschlag neu berechnen; ausserdem
 * startet die Serversuche erst, wenn die Eingabe zur Ruhe gekommen ist.
 */
export function useSearch(initial = '') {
  const [text, setText] = useState(initial)
  const [debounced, setDebounced] = useState(initial)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text), 220)
    return () => clearTimeout(timer)
  }, [text])

  return { text, setText, debounced }
}

export function runServerSearch(query: SearchQuery): void {
  void api.sync.searchServer(query).catch(() => {})
}

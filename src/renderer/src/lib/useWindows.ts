import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComposeSeed, DraftRef, MessageSummary } from '@shared/types'
import { CLOSE_MS } from '../components/windows/motion'

/** Was die App von aussen mit einem Verfassen-Fenster tun kann. */
export interface ComposerHandle {
  /** Speichert als Entwurf, wenn sich etwas geaendert hat; false bei Fehler. */
  flush: () => Promise<boolean>
  /** Schliessen wie mit X: erst speichern; false, wenn es dabei scheiterte und offen bleibt. */
  close: () => Promise<boolean>
}

interface WindowBase {
  id: string
  /** Fuer den Reiter: der Betreff, leer ohne */
  title: string
  /** Geschlossen, blendet noch aus; der Reiter ist schon weg. */
  leaving?: boolean
}

/** Ein offenes Verfassen-Fenster. */
export interface ComposeWindow extends WindowBase {
  kind: 'compose'
  seed: ComposeSeed
  /** Das letzte Speichern ist gescheitert */
  failed: boolean
  /** Der Entwurf auf dem Server, wie er nach dem letzten Speichern heisst */
  draftRef?: DraftRef
}

/** Eine Mail in ihrem eigenen Fenster, nur zum Lesen. */
export interface MailWindow extends WindowBase {
  kind: 'mail'
  message: MessageSummary
}

export type OpenWindow = ComposeWindow | MailWindow

function sameDraft(a?: DraftRef, b?: DraftRef): boolean {
  return Boolean(a && b && a.accountId === b.accountId && a.folder === b.folder && a.uid === b.uid)
}

/**
 * Die offenen Fenster und welches davon aufgeklappt ist. Hoechstens eins ist
 * aufgeklappt; die anderen liegen in der Leiste.
 *
 * Weggelegt wird nur, was gesichert ist: Hineinlegen, Wechseln und Schliessen
 * speichern ein geaendertes Verfassen-Fenster vorher. Scheitert das, bleibt
 * es aufgeklappt und zeigt den Fehler.
 */
export function useWindows() {
  const [windows, setWindows] = useState<OpenWindow[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const current = useRef(windows)
  current.current = windows
  const composers = useRef(new Map<string, ComposerHandle>())

  const expandedRef = useRef(expandedId)
  expandedRef.current = expandedId

  /** Das aufgeklappte Fenster vor dem Wechsel sichern; false, wenn das scheiterte. */
  const leaveExpanded = useCallback(async (): Promise<boolean> => {
    const open = expandedRef.current
    const handle = open ? composers.current.get(open) : undefined
    return handle ? handle.flush() : true
  }, [])

  const openCompose = useCallback(
    async (seed: ComposeSeed) => {
      // Derselbe Entwurf zweimal geoeffnet: das vorhandene Fenster nach vorn.
      const same =
        seed.draftRef &&
        current.current.find((w) => w.kind === 'compose' && !w.leaving && sameDraft(w.draftRef ?? w.seed.draftRef, seed.draftRef))
      // Laesst sich das offene nicht sichern, bleibt es vorn - das neue kommt
      // trotzdem, in die Leiste: ein mailto-Inhalt steht sonst nirgends.
      const left = await leaveExpanded()
      if (same) {
        if (left) setExpandedId(same.id)
        return
      }
      const id = crypto.randomUUID()
      setWindows((prev) => [...prev, { id, kind: 'compose', seed, title: seed.subject, failed: false }])
      if (left) setExpandedId(id)
    },
    [leaveExpanded]
  )

  /** Eine Mail im eigenen Fenster; ist sie schon offen, kommt dieses nach vorn. */
  const openMail = useCallback(
    async (message: MessageSummary) => {
      const same = current.current.find((w) => w.kind === 'mail' && !w.leaving && w.message.id === message.id)
      if (!(await leaveExpanded())) return
      if (same) {
        setExpandedId(same.id)
        return
      }
      const id = crypto.randomUUID()
      setWindows((prev) => [...prev, { id, kind: 'mail', message, title: message.subject }])
      setExpandedId(id)
    },
    [leaveExpanded]
  )

  /** Zu: der Reiter geht sofort, das Fenster blendet noch aus und wird dann abgebaut. */
  const closeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, leaving: true } : w)))
    setExpandedId((open) => (open === id ? null : open))
    window.setTimeout(() => setWindows((prev) => prev.filter((w) => w.id !== id)), CLOSE_MS + 20)
  }, [])

  const patch = useCallback((id: string, change: Partial<Pick<ComposeWindow, 'title' | 'failed' | 'draftRef'>>) => {
    setWindows((prev) => {
      const target = prev.find((w) => w.id === id)
      if (target?.kind !== 'compose' || Object.entries(change).every(([k, v]) => target[k as keyof ComposeWindow] === v)) return prev
      return prev.map((w) => (w.id === id && w.kind === 'compose' ? { ...w, ...change } : w))
    })
  }, [])

  /** Reiter geklickt: das aufgeklappte hineinlegen, ein anderes aufklappen. */
  const toggle = useCallback(
    async (id: string) => {
      if (!(await leaveExpanded())) return
      setExpandedId((open) => (open === id ? null : id))
    },
    [leaveExpanded]
  )

  /** Minimieren oder Klick daneben: gesichert in die Leiste. */
  const minimize = useCallback(async () => {
    if (await leaveExpanded()) setExpandedId(null)
  }, [leaveExpanded])

  /**
   * Der x am Reiter: schliessen wie mit X im Fenster, also mit Speichern.
   * Scheitert es, kommt das Fenster nach vorn - der Fehler steht darin.
   */
  const closeFromBar = useCallback(
    async (id: string) => {
      const handle = composers.current.get(id)
      if (!handle) {
        closeWindow(id)
        return
      }
      if (await handle.close()) return
      if (expandedRef.current !== id && (await leaveExpanded())) setExpandedId(id)
    },
    [closeWindow, leaveExpanded]
  )

  const register = useCallback((id: string, handle: ComposerHandle | null) => {
    if (handle) composers.current.set(id, handle)
    else composers.current.delete(id)
  }, [])

  // Vor dem Beenden: alles Geaenderte sichern. Scheitert eins, kommt es nach
  // vorn mit seinem Fehler und die App bleibt offen; ein zweites Beenden geht durch.
  const refusedQuit = useRef(false)
  useEffect(
    () =>
      window.api.on('app:before-quit', () => {
        const entries = [...composers.current.entries()]
        void Promise.all(entries.map(([, h]) => h.flush().catch(() => false))).then((results) => {
          const failed = entries.find((_, i) => !results[i])
          const ok = !failed || refusedQuit.current
          refusedQuit.current = !ok
          if (!ok && failed) setExpandedId(failed[0])
          window.api.quitReady(ok)
        })
      }),
    []
  )

  return { windows, expandedId, openCompose, openMail, closeWindow, patch, toggle, minimize, closeFromBar, register }
}

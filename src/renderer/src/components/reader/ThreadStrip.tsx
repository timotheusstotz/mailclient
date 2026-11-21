import type { MessageSummary } from '@shared/types'
import { dayTime, displayName } from '../../lib/format'

/**
 * Die Unterhaltung ueber der Mail, aelteste zuerst. Ein Klick tauscht die Mail
 * darunter aus; der Rahmen bleibt stehen.
 */
export function ThreadStrip({
  thread,
  currentId,
  folderTag,
  onOpen
}: {
  thread: MessageSummary[]
  currentId: string
  /** Ordner als Etikett, null fuer den Posteingang */
  folderTag: (message: MessageSummary) => string | null
  onOpen: (message: MessageSummary) => void
}) {
  return (
    <nav className="rv-thread" aria-label="Unterhaltung">
      <div className="rv-thread-head">Unterhaltung · {thread.length} Nachrichten</div>
      <div className="rv-thread-rows">
        {thread.map((item) => {
          const current = item.id === currentId
          const tag = folderTag(item)
          return (
            <button
              key={item.id}
              type="button"
              className="rv-trow"
              aria-current={current || undefined}
              data-unread={!item.flags.includes('\\Seen') || undefined}
              onClick={() => !current && onOpen(item)}
            >
              <span className="rv-dot" />
              <span className="rv-who">{displayName(item.from[0])}</span>
              <span className="rv-what">{item.snippet || item.subject}</span>
              {tag ? <span className="rv-tag">{tag}</span> : <span />}
              <span className="rv-when">{dayTime(item.date)}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

import type { Account } from '@shared/types'
import { useMailDragPointer } from '../../lib/mailDrag'

/**
 * Die Karte, die beim Ziehen von Mails dem Zeiger folgt. Ein eigenes Element
 * statt des Abbilds, das der Browser zum Start festhaelt: sie wird ueber einem
 * Ziel, das nichts annimmt, grau und nennt den Grund.
 */
export function DragGhost({ accountsById }: { accountsById: Map<string, Account> }) {
  const drag = useMailDragPointer()
  if (!drag) return null
  const first = drag.items[0]
  const many = drag.items.length > 1
  const accounts = [...drag.accountIds].map((id) => accountsById.get(id)?.label).filter(Boolean)
  const sender = first?.from[0]?.name || first?.from[0]?.address || ''

  return (
    <div
      className="lv-ghost"
      data-refused={drag.refused ? true : undefined}
      style={{ transform: `translate(${drag.x + 18}px, ${drag.y + 12}px)` }}
      aria-hidden="true"
    >
      {many && <div className="lv-ghost-back" />}
      <div className="lv-ghost-card">
        {many ? (
          <>
            <b>{drag.items.length} Mails</b>
            <span>{accounts.join(' und ')}</span>
          </>
        ) : (
          <>
            <b>{first?.subject || '(kein Betreff)'}</b>
            <span>{sender}</span>
          </>
        )}
        {many && <span className="lv-ghost-cnt">{drag.items.length}</span>}
      </div>
      {drag.refused?.note && <div className="lv-ghost-note">{drag.refused.note}</div>}
    </div>
  )
}

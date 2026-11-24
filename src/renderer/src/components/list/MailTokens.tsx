import { useLayoutEffect, useRef } from 'react'
import { useMailDragPointer } from '../../lib/mailDrag'
import { TOKEN_OFFSET, useFlights, type Flight } from '../../lib/listMotion'
import { IconMail } from '../icons'

/**
 * Die Briefchen ueber dem Fenster (docs/design/liste v4): das eine, das beim
 * Ziehen am Zeiger haengt, und die, die gerade in einen Ordner fliegen.
 */
export function MailTokens() {
  const flights = useFlights()
  return (
    <>
      <DragToken />
      {flights.map((flight) => (
        <FlightToken key={flight.id} flight={flight} />
      ))}
    </>
  )
}

/** Ein Briefchen: das Mail-Symbol auf einer kleinen Flaeche, bei mehreren mit der Zahl. */
function Token({ count }: { count: number }) {
  return (
    <div className="lv-env">
      <IconMail size={20} />
      {count > 1 && <span className="lv-env-cnt">{count}</span>}
    </div>
  )
}

/**
 * Haengt beim Ziehen am Zeiger. Es springt beim Greifen heraus und folgt mit
 * leichtem Nachlauf (CSS); ueber einem Ziel, das nichts annimmt, wird es grau
 * und nennt den Grund.
 */
function DragToken() {
  const drag = useMailDragPointer()
  if (!drag) return null
  return (
    <div
      className="lv-env-drag"
      data-drag-token
      data-refused={drag.refused ? true : undefined}
      style={{ transform: `translate(${drag.x + TOKEN_OFFSET.x}px, ${drag.y + TOKEN_OFFSET.y}px)` }}
      aria-hidden="true"
    >
      <Token count={drag.items.length} />
      {drag.refused?.note && <div className="lv-env-note">{drag.refused.note}</div>}
    </div>
  )
}

/** Ein Briefchen unterwegs; den Weg setzt der Flug selbst, sobald es eingehaengt ist. */
function FlightToken({ flight }: { flight: Flight }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (ref.current) flight.run(ref.current)
  }, [flight])
  return (
    <div ref={ref} className="lv-env-fly" aria-hidden="true">
      <Token count={flight.count} />
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { Address, Contact } from '@shared/types'
import { formatAddressFull, isValidEmail, parseAddresses } from '../../lib/format'
import { IconClose } from '../icons'
import { useOptionList } from '../reader/Menu'

interface Props {
  id: string
  label: string
  /** Die ganze Zeile als Text, Adressen durch Komma getrennt */
  value: string
  onChange: (value: string) => void
  placeholder?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
  /** Rechts in der Zeile, etwa "Kopie, Blindkopie" */
  trailing?: React.ReactNode
}

/** Schneidet die Zeile am letzten Komma: davor die fertigen Adressen, dahinter, was gerade getippt wird. */
function split(value: string): { done: string; typing: string } {
  const cut = Math.max(value.lastIndexOf(','), value.lastIndexOf(';'))
  return { done: value.slice(0, cut + 1), typing: value.slice(cut + 1).replace(/^\s+/, '') }
}

/** Die fertigen Eintraege, auch solche ohne gueltige Adresse - sie sollen sichtbar bleiben, nicht verschwinden. */
function entries(done: string): Address[] {
  return done
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => parseAddresses(part)[0] ?? { address: part })
}

function join(addresses: string[], typing: string): string {
  return addresses.length ? `${addresses.join(', ')}, ${typing}` : typing
}

/**
 * Empfaengerfeld: jede fertige Adresse eine Marke, dahinter das Eingabefeld
 * mit Vorschlaegen aus dem Adressbuch.
 *
 * Die Zeile bleibt ein Text mit Kommas - das Fenster speichert und sendet ihn
 * so. Die Marken sind nur seine Ansicht: alles vor dem letzten Komma ist
 * fertig, das Eingabefeld haelt den Rest. Ein Komma, Enter auf einem Vorschlag
 * oder das Verlassen des Felds mit einer gueltigen Adresse macht eine Marke.
 *
 * Das Adressbuch pflegt niemand - es entsteht im Hauptprozess aus den Mails,
 * die ohnehin da sind.
 */
export function AddressField(props: Props) {
  const { done, typing } = split(props.value)
  const chips = entries(done)
  const [suggestions, setSuggestions] = useState<Contact[]>([])
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const fragment = typing.trim()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const timer = setTimeout(() => {
      void window.api.contacts.suggest(fragment).then((list) => {
        if (!cancelled) setSuggestions(list)
      })
    }, 90)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [fragment, open])

  const shown = open && suggestions.length > 0
  const apply = (contact: Contact): void => {
    props.onChange(join([...chips.map(formatAddressFull), formatAddressFull({ name: contact.name, address: contact.address })], ''))
    setOpen(false)
    setSuggestions([])
  }
  const options = useOptionList(suggestions, shown, apply)

  const remove = (index: number): void => {
    props.onChange(join(chips.filter((_, i) => i !== index).map(formatAddressFull), typing))
    props.inputRef?.current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    // Enter im offenen Vorschlagsfeld uebernimmt, statt die Mail zu senden.
    if (options.onKeyDown(event)) {
      event.stopPropagation()
      return
    }
    // Ohne gewaehlten Eintrag nimmt Enter den ersten Vorschlag, wie bisher.
    if ((event.key === 'Enter' || event.key === 'Tab') && shown && fragment && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      apply(suggestions[0])
      return
    }
    if (event.key === 'Escape' && shown) {
      event.stopPropagation()
      setOpen(false)
      return
    }
    if (event.key === 'Backspace' && !typing && chips.length) {
      event.preventDefault()
      // Die letzte Marke wird wieder Text: so laesst sie sich korrigieren statt neu tippen.
      const last = formatAddressFull(chips[chips.length - 1])
      props.onChange(join(chips.slice(0, -1).map(formatAddressFull), last))
    }
  }

  // Wer das Feld mit einer vollstaendigen Adresse verlaesst, meint sie.
  const onBlur = (event: React.FocusEvent): void => {
    if (boxRef.current?.contains(event.relatedTarget as Node)) return
    setOpen(false)
    if (isValidEmail(parseAddresses(typing)[0]?.address ?? '')) props.onChange(`${props.value}, `)
  }

  return (
    <div className="cw-line">
      <label className="cw-k" htmlFor={props.id}>
        {props.label}
      </label>
      <div className="cw-recips" ref={boxRef} onBlur={onBlur}>
        {chips.map((address, index) => (
          <span className="rc" key={`${address.address}-${index}`} title={formatAddressFull(address)}>
            <span className="rc-name">{address.name || address.address}</span>
            <button type="button" aria-label={`${address.address} entfernen`} onClick={() => remove(index)}>
              <IconClose size={12} />
            </button>
          </span>
        ))}
        <input
          id={props.id}
          ref={props.inputRef}
          className="cw-type"
          value={typing}
          placeholder={chips.length ? undefined : props.placeholder}
          autoComplete="off"
          spellCheck={false}
          {...options.inputProps}
          onChange={(event) => {
            props.onChange(done ? `${done} ${event.target.value}` : event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {shown && (
          <ul className="rv-menu cw-suggest" {...options.listProps}>
            {suggestions.map((contact, index) => (
              <li key={contact.address} {...options.optionProps(index)}>
                <span className="rv-mi-label">
                  {contact.name || contact.address}
                  {contact.name && <span className="cw-pick-addr"> {contact.address}</span>}
                </span>
                {contact.written && <span className="cw-suggest-mark">geschrieben</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {props.trailing ?? <span />}
    </div>
  )
}

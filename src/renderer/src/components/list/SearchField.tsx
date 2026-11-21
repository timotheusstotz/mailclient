import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { IconClose, IconGlobe, IconSearch } from '../icons'
import { useOptionList } from '../reader/Menu'

/** Die Suchkürzel aus @shared/search, so wie die Hilfe sie anbietet. */
const SHORTCUTS: { code: string; hint: string; what: string }[] = [
  { code: 'von:', hint: 'name', what: 'Absender, Name oder Adresse' },
  { code: 'an:', hint: 'name', what: 'Empfänger' },
  { code: 'betreff:', hint: 'wort', what: 'Wort im Betreff' },
  { code: 'datei:', hint: 'name', what: 'Name eines Anhangs' },
  { code: 'hat:anhang', hint: '', what: 'Nur mit Anhang' },
  { code: 'ist:ungelesen', hint: '', what: 'Nur ungelesene' },
  { code: 'ist:markiert', hint: '', what: 'Nur markierte' },
  { code: 'vor:', hint: '31.01.2026', what: 'Älter als dieses Datum' },
  { code: 'nach:', hint: '31.12.2025', what: 'Neuer als dieses Datum' }
]

/** Schlüssel, die parseSearch kennt: nur die werden im Feld hervorgehoben. */
const KEYS = new Set(['von', 'from', 'an', 'to', 'betreff', 'subject', 'datei', 'file', 'filename', 'hat', 'has', 'ist', 'is', 'vor', 'before', 'nach', 'seit', 'after', 'since'])

interface Props {
  value: string
  onChange: (value: string) => void
  inputRef?: React.RefObject<HTMLInputElement | null>
  /** Wo gesucht wird, für den Fuß der Hilfe */
  scope: string
}

/** Das Wort, an dem gerade getippt wird: alles nach dem letzten Leerzeichen. */
const currentWord = (text: string): string => /(\S*)$/.exec(text)?.[1] ?? ''

/** Die Kürzel, die zum angefangenen Wort passen; ein fertig getipptes zählt nicht mehr. */
function matching(text: string): typeof SHORTCUTS {
  const word = currentWord(text).toLowerCase()
  if (!word) return text.trim() ? [] : SHORTCUTS
  return SHORTCUTS.filter((s) => s.code.startsWith(word) && s.code !== word)
}

/**
 * Das Suchfeld. Erkannte Kürzel ("von:anna") stehen hervorgehoben im Feld: eine
 * Spiegelschicht hinter dem durchsichtigen Text des Eingabefelds zeichnet sie,
 * so bleiben Cursor und Markieren die des Browsers.
 *
 * Bekommt das leere Feld den Fokus, klappt die Hilfe mit den Kürzeln auf. Sie
 * schließt bei Esc, beim Verlassen des Felds und beim ersten Zeichen, das zu
 * keinem Kürzel passt. Esc leert danach das Feld und verlässt es zuletzt.
 */
export function SearchField({ value, onChange, inputRef, scope }: Props) {
  const ownRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? ownRef
  const mirrorRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [helpWanted, setHelpWanted] = useState(false)
  const options = matching(value)
  const open = focused && helpWanted && options.length > 0

  const syncScroll = useCallback(() => {
    const input = ref.current
    if (input && mirrorRef.current) mirrorRef.current.style.transform = `translateX(${-input.scrollLeft}px)`
  }, [ref])
  /** Nach dem Einsetzen eines Kürzels: Cursor ans Ende, sobald der neue Text im Feld steht. */
  const caretToEnd = useRef(false)
  useLayoutEffect(() => {
    const input = ref.current
    if (caretToEnd.current && input) {
      caretToEnd.current = false
      input.setSelectionRange(value.length, value.length)
      input.scrollLeft = input.scrollWidth
    }
    syncScroll()
  }, [value, ref, syncScroll])

  const change = (next: string): void => {
    onChange(next)
    if (!matching(next).length) setHelpWanted(false)
  }

  const pick = (shortcut: (typeof SHORTCUTS)[number]): void => {
    const word = currentWord(value)
    const head = value.slice(0, value.length - word.length)
    const next = `${head}${head && !/\s$/.test(head) ? ' ' : ''}${shortcut.code}${shortcut.code.endsWith(':') ? '' : ' '}`
    caretToEnd.current = true
    change(next)
    ref.current?.focus()
  }

  const list = useOptionList(options, open, pick)

  return (
    <>
      <div className="lv-sf" role="search" data-focus={focused || undefined} onClick={() => ref.current?.focus()}>
        <IconSearch />
        <div className="lv-sf-box">
          <div className="lv-sf-mirror" ref={mirrorRef} aria-hidden="true">
            {/* Ein Inline-Span: als Flex-Kinder fielen die Leerzeichen zwischen zwei Kürzeln weg. */}
            <span>{highlightTokens(value)}</span>
          </div>
          <input
            ref={ref}
            type="text"
            className="lv-sf-input"
            value={value}
            placeholder="Durchsuchen"
            aria-label="Nachrichten durchsuchen"
            spellCheck={false}
            autoComplete="off"
            {...list.inputProps}
            onChange={(event) => change(event.target.value)}
            onScroll={syncScroll}
            onSelect={syncScroll}
            onFocus={() => {
              setFocused(true)
              if (!value) setHelpWanted(true)
            }}
            onBlur={() => {
              setFocused(false)
              setHelpWanted(false)
            }}
            onKeyDown={(event) => {
              if (list.onKeyDown(event)) return
              if (event.key !== 'Escape') return
              event.preventDefault()
              if (open) setHelpWanted(false)
              else if (value) change('')
              else event.currentTarget.blur()
            }}
          />
        </div>
        {value ? (
          <button
            type="button"
            className="lv-sf-clear"
            aria-label="Suche leeren"
            title="Suche leeren (Esc)"
            onClick={(event) => {
              event.stopPropagation()
              change('')
              ref.current?.focus()
            }}
          >
            <IconClose size={14} />
          </button>
        ) : (
          <kbd className="rv-lbl-k" aria-hidden="true">
            Strg F
          </kbd>
        )}
      </div>

      {open && (
        <div className="rv-menu lv-sh" {...list.listProps} aria-label="Suchkürzel">
          <div className="rv-menu-title" aria-hidden="true">
            Suchkürzel · tippen oder anklicken
          </div>
          {options.map((shortcut, index) => (
            <div key={shortcut.code} {...list.optionProps(index)}>
              <span className="lv-sh-code">
                {shortcut.code}
                <i>{shortcut.hint}</i>
              </span>
              <span className="lv-sh-what">{shortcut.what}</span>
            </div>
          ))}
          <div className="lv-sh-foot">
            <IconGlobe size={14} />
            {scope}
          </div>
        </div>
      )}
    </>
  )
}

/** Der Text des Felds für die Spiegelschicht, erkannte Kürzel als Marke. */
function highlightTokens(text: string): ReactNode[] {
  return text.split(/(\s+)/).map((part, index) => {
    const match = /^([A-Za-z]+:)(.+)$/.exec(part)
    if (!match || !KEYS.has(match[1].slice(0, -1).toLowerCase())) return part
    return (
      <span className="lv-tok" key={index}>
        <i>{match[1]}</i>
        {match[2]}
      </span>
    )
  })
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'

/*
  Ein Menue an einem Knopf: Zurueckstellen und Verschieben in der Leiste.

  Geoeffnet wird per Klick oder Tastatur. Mit der Tastatur geoeffnet bekommt der
  erste Eintrag den Fokus, mit der Maus das Menue selbst - so greifen Pfeiltasten
  und Esc in beiden Faellen. Ein Element mit data-autofocus (das Suchfeld beim
  Verschieben) geht immer vor.

  Es schliesst sich bei Esc, Tab, einem Klick daneben, wenn das Fenster den
  Fokus verliert (Klick in die Mail: die liegt in einem eigenen Dokument) und
  nach einer Wahl. Der Fokus geht dann zurueck an den Ausloeser, ausser er ist
  schon bewusst woanders hingegangen.

  Solange es offen ist, gehoert ihm die Tastatur: Buchstaben loesen nicht die
  Kuerzel des Fensters aus (E wuerde sonst archivieren). Strg- und
  Alt-Kombinationen bleiben unangetastet, damit Strg+Plus weiter vergroessert.
*/

const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])'

interface MenuContextValue {
  close: () => void
}

const MenuContext = createContext<MenuContextValue>({ close: () => {} })

interface MenuButtonProps {
  /** Zugaenglicher Name des Ausloesers */
  label: string
  /** Tooltip, mit Kuerzel */
  title: string
  className: string
  /** Inhalt des Ausloesers: Icon, Beschriftung, Pfeil */
  children: ReactNode
  /** Name des Menues fuer Screenreader */
  menuLabel: string
  menuClassName: string
  /** Inhalt des Menues; wird erst beim Oeffnen gebaut */
  menu: () => ReactNode
  /** Steht da, oeffnet aber nicht; der Tooltip sagt, warum */
  disabled?: boolean
  /** Inhalt des Ausloesers fuer Screenreader statt `label`, wenn der sichtbare Text zaehlt */
  labelledByContent?: boolean
}

export function MenuButton({
  label,
  title,
  className,
  children,
  menuLabel,
  menuClassName,
  menu,
  disabled = false,
  labelledByContent = false
}: MenuButtonProps) {
  const [open, setOpen] = useState<false | { byKeyboard: boolean }>(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  // Fokus beim Oeffnen setzen, bevor gezeichnet wird - sonst blitzt der Ring am Ausloeser.
  useLayoutEffect(() => {
    const node = menuRef.current
    if (!open || !node) return
    const preferred = node.querySelector<HTMLElement>('[data-autofocus]')
    const first = node.querySelector<HTMLElement>(ITEM_SELECTOR)
    ;(preferred ?? (open.byKeyboard ? first : null) ?? node).focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (wrapRef.current?.contains(event.target as Node)) return
      close(false)
      // Ging der Klick auf etwas, das keinen Fokus nimmt, faengt der Ausloeser ihn auf.
      window.setTimeout(() => {
        if (document.activeElement === document.body) triggerRef.current?.focus()
      })
    }
    const onBlur = (): void => close(false)
    // Esc schliesst auch, wenn der Fokus gerade nicht im Menue steht.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKey)
    }
  }, [close, open])

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    event.stopPropagation()
    const node = menuRef.current
    if (!node) return
    const items = Array.from(node.querySelectorAll<HTMLElement>(ITEM_SELECTOR))
    const index = items.indexOf(document.activeElement as HTMLElement)
    const inField = (event.target as HTMLElement).tagName === 'INPUT'
    const focusAt = (i: number): void => {
      event.preventDefault()
      items[(i + items.length) % items.length]?.focus()
    }
    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        close()
        break
      case 'Tab':
        event.preventDefault()
        close()
        break
      case 'ArrowDown':
        focusAt(index + 1)
        break
      case 'ArrowUp':
        focusAt(index < 0 ? -1 : index - 1)
        break
      case 'Home':
        if (!inField) focusAt(0)
        break
      case 'End':
        if (!inField) focusAt(-1)
        break
    }
  }

  return (
    <div className="rv-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        aria-label={labelledByContent ? undefined : label}
        title={title}
        aria-haspopup="menu"
        aria-expanded={Boolean(open)}
        aria-controls={open ? menuId : undefined}
        aria-disabled={disabled || undefined}
        onClick={(event) => {
          if (disabled) return
          if (open) {
            close()
            return
          }
          // detail 0: ausgeloest per Enter oder Leertaste, nicht per Maus.
          setOpen({ byKeyboard: event.detail === 0 })
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open && !disabled) {
            event.preventDefault()
            event.stopPropagation()
            setOpen({ byKeyboard: true })
          }
        }}
      >
        {children}
      </button>
      {open && (
        <MenuContext.Provider value={{ close }}>
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={menuLabel}
            tabIndex={-1}
            className={menuClassName}
            onKeyDown={onMenuKeyDown}
          >
            {menu()}
          </div>
        </MenuContext.Provider>
      )}
    </div>
  )
}

interface MenuItemProps {
  icon: ReactNode
  children: ReactNode
  /** Rechts in der Zeile: Uhrzeit, Kuerzel oder "aktuell" */
  meta?: ReactNode
  /** Steht da, laesst sich aber nicht waehlen (der Ordner, in dem die Mail schon liegt) */
  current?: boolean
  onSelect?: () => void
}

/** Ein Eintrag: schliesst das Menue und fuehrt dann seine Aktion aus. */
export function MenuItem({ icon, children, meta, current = false, onSelect }: MenuItemProps) {
  const { close } = useContext(MenuContext)
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className="rv-mi"
      aria-disabled={current || undefined}
      aria-current={current || undefined}
      onClick={() => {
        if (current) return
        close()
        onSelect?.()
      }}
    >
      {icon}
      <span className="rv-mi-label">{children}</span>
      {meta !== undefined && <span className="rv-mi-meta">{meta}</span>}
    </button>
  )
}

/** Fuer Eintraege, die nicht aus MenuItem bestehen (das Suchfeld): schliesst wie eine Wahl. */
export function useMenuClose(): () => void {
  return useContext(MenuContext).close
}

/*
  Dasselbe Menue unter einem Eingabefeld, die Suchkuerzel: der Fokus bleibt im
  Feld, die Pfeile wandern durch die Eintraege (aria-activedescendant), Enter
  waehlt. Ein Klick waehlt ebenfalls, ohne dem Feld den Fokus zu nehmen.
  Schliessen regelt das Feld selbst - bei Esc, Blur und Tippen.
*/

export interface OptionList {
  /** Ans Eingabefeld */
  inputProps: {
    role: 'combobox'
    'aria-expanded': boolean
    'aria-controls': string | undefined
    'aria-activedescendant': string | undefined
    'aria-autocomplete': 'list'
  }
  /** An die Liste */
  listProps: { id: string; role: 'listbox' }
  /** An jeden Eintrag */
  optionProps: (index: number) => {
    id: string
    role: 'option'
    className: string
    'aria-selected': boolean
    onPointerDown: (event: React.PointerEvent) => void
    onPointerMove: () => void
    onClick: () => void
  }
  /** Aus dem onKeyDown des Felds; true, wenn die Taste dem Menue gehoerte */
  onKeyDown: (event: ReactKeyboardEvent) => boolean
}

export function useOptionList<T>(options: T[], open: boolean, onPick: (option: T) => void): OptionList {
  const id = useId()
  const [active, setActive] = useState(-1)
  useEffect(() => setActive(-1), [open, options.length])
  const shown = open && options.length > 0

  return {
    inputProps: {
      role: 'combobox',
      'aria-expanded': shown,
      'aria-controls': shown ? id : undefined,
      'aria-activedescendant': shown && active >= 0 ? `${id}-${active}` : undefined,
      'aria-autocomplete': 'list'
    },
    listProps: { id, role: 'listbox' },
    optionProps: (index) => ({
      id: `${id}-${index}`,
      role: 'option',
      className: 'rv-mi',
      'aria-selected': index === active,
      // Der Klick soll dem Feld den Fokus nicht nehmen.
      onPointerDown: (event) => event.preventDefault(),
      onPointerMove: () => setActive(index),
      onClick: () => onPick(options[index])
    }),
    onKeyDown: (event) => {
      if (!shown || event.ctrlKey || event.metaKey || event.altKey) return false
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          setActive((i) => (i + 1) % options.length)
          return true
        case 'ArrowUp':
          event.preventDefault()
          setActive((i) => (i <= 0 ? options.length - 1 : i - 1))
          return true
        case 'Enter':
          if (active < 0) return false
          event.preventDefault()
          onPick(options[active])
          return true
      }
      return false
    }
  }
}

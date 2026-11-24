/** Ein einheitlicher Strichsatz: 1.6px, runde Enden, 16er-Raster. */

interface IconProps {
  size?: number
  className?: string
}

/** `name` landet als data-icon am Element: daran haengt die Hover-Bewegung in interaction.css. */
function svg(path: React.ReactNode, size = 16, className?: string, name?: string) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      data-icon={name}
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}

export const IconInbox = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M1.8 9.5h3l1 1.8h4.4l1-1.8h3" />
      <path d="M3.2 2.8h9.6l1.4 6.7v2.4a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1V9.5z" />
    </>,
    size,
    className,
    'inbox'
  )

export const IconSent = ({ size, className }: IconProps) =>
  svg(<path d="M14.2 1.8 7 9M14.2 1.8 9.7 14.2 7 9 1.8 6.3z" />, size, className, 'sent')

export const IconDraft = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M9 1.8H4a1 1 0 0 0-1 1v10.4a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.8z" />
      <path d="M9 1.8v4h4" />
    </>,
    size,
    className,
    'draft'
  )

export const IconTrash = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M2.6 4h10.8M6.3 4V2.6h3.4V4M4 4l.6 9.4h6.8L12 4" />
      <path d="M6.6 6.8v4M9.4 6.8v4" />
    </>,
    size,
    className,
    'trash'
  )

export const IconJunk = ({ size, className }: IconProps) =>
  svg(
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 5v3.6M8 10.8h.01" />
    </>,
    size,
    className,
    'junk'
  )

export const IconArchive = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M1.8 2.6h12.4v2.8H1.8z" />
      <path d="M2.9 5.4v7a1 1 0 0 0 1 1h8.2a1 1 0 0 0 1-1v-7" />
      <path d="M6.4 8.2h3.2" />
    </>,
    size,
    className,
    'archive'
  )

export const IconFolder = ({ size, className }: IconProps) =>
  svg(
    <path d="M1.8 12.6V3.4a.8.8 0 0 1 .8-.8h3.1l1.5 1.8h6a.8.8 0 0 1 .8.8v7.4a.8.8 0 0 1-.8.8H2.6a.8.8 0 0 1-.8-.8z" />,
    size,
    className,
    'folder'
  )

export const IconStar = ({ size, className }: IconProps) =>
  svg(<path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />, size, className, 'star')

export const IconStarFilled = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} data-icon="star-filled" aria-hidden="true">
    <path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
  </svg>
)

export const IconPaperclip = ({ size, className }: IconProps) =>
  svg(
    <path d="M12.9 7.4 7.6 12.7a3.1 3.1 0 0 1-4.4-4.4l5.6-5.6a2.1 2.1 0 0 1 2.9 2.9l-5.5 5.6a1 1 0 0 1-1.5-1.5l5.1-5.1" />,
    size,
    className,
    'paperclip'
  )

export const IconSearch = ({ size, className }: IconProps) =>
  svg(
    <>
      <circle cx="7.2" cy="7.2" r="4.6" />
      <path d="m10.6 10.6 3 3" />
    </>,
    size,
    className,
    'search'
  )

export const IconReply = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M6 3.4 1.8 7.2 6 11" />
      <path d="M1.8 7.2h6.4a5 5 0 0 1 5 5v1" />
    </>,
    size,
    className,
    'reply'
  )

export const IconReplyAll = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M5 3.4 1.4 7.2 5 11" />
      <path d="M8.6 3.4 5 7.2 8.6 11" />
      <path d="M5 7.2h4.4a4.6 4.6 0 0 1 4.6 4.6v1" />
    </>,
    size,
    className,
    'reply-all'
  )

export const IconForward = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M10 3.4 14.2 7.2 10 11" />
      <path d="M14.2 7.2H7.8a5 5 0 0 0-5 5v1" />
    </>,
    size,
    className,
    'forward'
  )

export const IconCompose = ({ size = 18, className }: IconProps) =>
  svg(
    <>
      <path d="M11.4 2.4a1.6 1.6 0 0 1 2.2 2.2L5.9 12.3l-3 .8.8-3z" />
      <path d="M10.2 3.6 12.4 5.8" />
    </>,
    size,
    className,
    'compose'
  )

export const IconRefresh = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M13.6 8a5.6 5.6 0 1 1-1.7-4" />
      <path d="M13.4 1.6v3h-3" />
    </>,
    size,
    className,
    'refresh'
  )

export const IconSettings = ({ size, className }: IconProps) =>
  svg(
    // Ein Zahnrad wie im Entwurf; gezeichnet im 24er-Raster und auf 16 verkleinert.
    <g transform="scale(0.6667)" strokeWidth="2.4">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </g>,
    size,
    className,
    'settings'
  )

export const IconClock = ({ size, className }: IconProps) =>
  svg(
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.6V8l2.3 1.5" />
    </>,
    size,
    className,
    'clock'
  )

export const IconClose = ({ size, className }: IconProps) =>
  svg(<path d="M3.6 3.6 12.4 12.4M12.4 3.6 3.6 12.4" />, size, className, 'close')

export const IconLayers = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M8 1.8 1.8 5 8 8.2 14.2 5z" />
      <path d="m1.8 8 6.2 3.2L14.2 8" />
      <path d="m1.8 11 6.2 3.2L14.2 11" />
    </>,
    size,
    className,
    'layers'
  )

export const IconPlus = ({ size, className }: IconProps) =>
  svg(<path d="M8 2.8v10.4M2.8 8h10.4" />, size, className, 'plus')

export const IconEnvelopeOpen = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M1.8 6.6 8 2.2l6.2 4.4v6a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z" />
      <path d="m1.8 6.6 6.2 4.2 6.2-4.2" />
    </>,
    size,
    className,
    'envelope-open'
  )

export const IconDownload = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M8 2.2v7.6" />
      <path d="m4.8 6.9 3.2 3.2 3.2-3.2" />
      <path d="M2.6 11.4v1.4a1 1 0 0 0 1 1h8.8a1 1 0 0 0 1-1v-1.4" />
    </>,
    size,
    className,
    'download'
  )

export const IconFile = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M9 1.8H4.2a1 1 0 0 0-1 1v10.4a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V5.4z" />
      <path d="M9 1.8v3.6h3.8" />
    </>,
    size,
    className,
    'file'
  )

export const IconAttach = IconPaperclip

export const IconChevron = ({ size, className }: IconProps) =>
  svg(<path d="m4 6 4 4 4-4" />, size, className, 'chevron')

/** Pfeil nach rechts zum Aufklappen; offen dreht ihn das CSS um 90 Grad nach unten. */
export const IconChevronRight = ({ size, className }: IconProps) =>
  svg(<path d="m6 4 4 4-4 4" />, size, className, 'chevron-right')

/** Die Welt: sucht auch auf dem Server. */
export const IconGlobe = ({ size, className }: IconProps) =>
  svg(
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M1.8 8h12.4M8 1.8c1.7 1.7 2.5 3.8 2.5 6.2S9.7 12.5 8 14.2C6.3 12.5 5.5 10.4 5.5 8S6.3 3.5 8 1.8z" />
    </>,
    size,
    className,
    'globe'
  )

/** Ein offener Bogen, der sich dreht, solange abgerufen wird. */
export const IconSpinner = ({ size, className }: IconProps) =>
  svg(<path d="M13.6 8A5.6 5.6 0 1 1 8 2.4" />, size, className, 'spinner')

export const IconCheck = ({ size, className }: IconProps) =>
  svg(<path d="m3.2 8.4 3.2 3 6.4-6.6" />, size, className, 'check')

export const IconAlert = ({ size, className }: IconProps) =>
  svg(
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.8v3.8M8 11h.01" />
    </>,
    size,
    className,
    'alert'
  )

/** Pfeil gegen den Uhrzeigersinn: noch einmal versuchen. */
export const IconReset = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8" />
      <path d="M2.6 2.4v3.2h3.2" />
    </>,
    size,
    className,
    'reset'
  )

export const IconUndo = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M6 9.4 2.6 6 6 2.6" />
      <path d="M2.6 6h7.2a3.4 3.4 0 0 1 0 6.8H8" />
    </>,
    size,
    className,
    'undo'
  )

export const IconMoon = ({ size, className }: IconProps) =>
  svg(<path d="M13.4 9.8A5.8 5.8 0 1 1 6.2 2.6a4.6 4.6 0 0 0 7.2 7.2z" />, size, className, 'moon')

export const IconSunrise = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M1.8 12.8h12.4" />
      <path d="M4.4 12.8a3.6 3.6 0 0 1 7.2 0" />
      <path d="M8 1.8v4M6.4 3.4 8 1.8l1.6 1.6" />
      <path d="m2.6 8.8 1.2.7M13.4 8.8l-1.2.7" />
    </>,
    size,
    className,
    'sunrise'
  )

export const IconCalendarArrow = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M3.4 3.2h9.2a1 1 0 0 1 1 1v8.6a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V4.2a1 1 0 0 1 1-1z" />
      <path d="M2.4 6.4h11.2M5.4 1.8v2.4M10.6 1.8v2.4" />
      <path d="M5.8 10.2h4.2M8.6 8.8l1.4 1.4-1.4 1.4" />
    </>,
    size,
    className,
    'calendar-arrow'
  )

export const IconImage = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M3 2.8h10a1 1 0 0 1 1 1v8.4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1z" />
      <path d="m2 10.6 3-3 2.6 2.6 1.8-1.8 4.6 4.4" />
      <path d="M10.6 6h.01" />
    </>,
    size,
    className,
    'image'
  )

export const IconImageOff = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="m2 2 12 12" />
      <path d="M14 10.2V3.8a1 1 0 0 0-1-1H6.2" />
      <path d="M2 4.8v7.4a1 1 0 0 0 1 1h7.4" />
      <path d="m2 10.6 2.6-2.6 2 2" />
    </>,
    size,
    className,
    'image-off'
  )

export const IconMail = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M2.8 3.4h10.4a1 1 0 0 1 1 1v7.2a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1z" />
      <path d="m1.8 4.6 6.2 4.2 6.2-4.2" />
    </>,
    size,
    className,
    'mail'
  )

/** Umschlag mit Punkt: wieder als ungelesen markieren. */
export const IconMailUnread = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M14 8.2v3.6a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 11.8V5.4a1.2 1.2 0 0 1 1.2-1.2h6" />
      <path d="m2 5.4 6 4 2.6-1.7" />
      <circle cx="12.8" cy="4.4" r="1.7" />
    </>,
    size,
    className,
    'mail-unread'
  )

export const IconFolderMove = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M1.8 12.6V3.4a.8.8 0 0 1 .8-.8h3.1l1.5 1.8h6a.8.8 0 0 1 .8.8v7.4a.8.8 0 0 1-.8.8H2.6a.8.8 0 0 1-.8-.8z" />
      <path d="M5.6 8.6h4.6M8.8 7.2l1.4 1.4-1.4 1.4" />
    </>,
    size,
    className,
    'folder-move'
  )

/** Pfeil in eine Linie: ein Fenster in die Leiste legen. */
export const IconMinimize = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M8 2.6v6.8" />
      <path d="m5 6.4 3 3 3-3" />
      <path d="M3.2 12.8h9.6" />
    </>,
    size,
    className,
    'minimize'
  )

/** Diskette: als Entwurf speichern. */
export const IconSave = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M3.2 2.6h7.4l2.2 2.2v8.6H3.2z" />
      <path d="M5.4 2.6v3.4h4.8V2.6" />
      <path d="M5.4 13.4V9.4h5.4v4" />
    </>,
    size,
    className,
    'save'
  )

/** Blatt mit Zeilen: ein Textbaustein. */
export const IconTemplate = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M3.4 2.6h9.2v10.8H3.4z" />
      <path d="M6 5.4h4M6 8h4M6 10.6h2" />
    </>,
    size,
    className,
    'template'
  )

/** Warndreieck: etwas ist schiefgegangen, der Text ist aber sicher. */
export const IconWarn = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M7 2.7 1.8 11.7a1.2 1.2 0 0 0 1 1.8h10.4a1.2 1.2 0 0 0 1-1.8L9 2.7a1.2 1.2 0 0 0-2 0z" />
      <path d="M8 6v3.2M8 11.2h.01" />
    </>,
    size,
    className,
    'warn'
  )

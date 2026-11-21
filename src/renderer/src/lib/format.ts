import type { Address, MessageSummary } from '@shared/types'

const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short' })
const yearFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
const fullFmt = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})

/** Kurzdatum fuer die Liste: heute die Uhrzeit, sonst Tag, sonst Jahr. */
export function shortDate(ms: number): string {
  const date = new Date(ms)
  const now = new Date()
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  if (sameDay) return timeFmt.format(date)
  if (date.getFullYear() === now.getFullYear()) return dayFmt.format(date)
  return yearFmt.format(date)
}

const weekdayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short' })

/** Ein Zeitpunkt in der Zukunft, knapp: "18:00", "Mo 08:00" oder "12. Okt. 08:00". */
export function shortDateTime(ms: number): string {
  const date = new Date(ms)
  const now = new Date()
  const time = timeFmt.format(date)
  const dayStart = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((dayStart(date) - dayStart(now)) / 86_400_000)
  if (days === 0) return time
  if (days === 1) return `morgen ${time}`
  if (days > 1 && days < 7) return `${weekdayFmt.format(date).replace('.', '')} ${time}`
  return `${dayFmt.format(date)} ${time}`
}

export function fullDate(ms: number): string {
  return fullFmt.format(new Date(ms))
}

const headFmt = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})
const dayTimeFmt = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})
const weekdayTimeFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
const dateTimeFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Datum im Kopf einer Mail: "Mo., 16. Nov. 2026, 17:13". */
export function headDate(ms: number): string {
  return headFmt.format(new Date(ms))
}

/** Zeitpunkt ohne Jahr: "Mo., 23. Nov., 08:00" - fuer Zurueckgestelltes und den Verlauf. */
export function dayTime(ms: number): string {
  return dayTimeFmt.format(new Date(ms))
}

/**
 * Ein Zeitpunkt in der Zukunft, so kurz, wie er neben einem Namen noch eindeutig
 * ist: heute "18:00", morgen "Di., 08:00", sonst "23. Nov., 08:00".
 */
export function upcomingTime(ms: number, now = new Date()): string {
  const date = new Date(ms)
  const dayStart = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((dayStart(date) - dayStart(now)) / 86_400_000)
  if (days === 0) return timeFmt.format(date)
  if (days === 1) return weekdayTimeFmt.format(date)
  return dateTimeFmt.format(date)
}

/** Etikett einer zurückgestellten Mail in der Liste: "bis 18:00", "bis Mo., 08:00", "bis 23. Nov., 08:00". */
export function snoozeTag(ms: number, now = new Date()): string {
  const date = new Date(ms)
  const dayStart = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((dayStart(date) - dayStart(now)) / 86_400_000)
  if (days === 0) return `bis ${timeFmt.format(date)}`
  if (days > 0 && days < 7) return `bis ${weekdayTimeFmt.format(date)}`
  return `bis ${dateTimeFmt.format(date)}`
}

/** "1 Konto", "3 Konten" */
export function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function displayName(address?: Address): string {
  if (!address) return 'Unbekannt'
  return address.name || address.address
}

export function addressList(list: Address[], max = 3): string {
  if (!list.length) return ''
  const names = list.slice(0, max).map(displayName)
  const rest = list.length - names.length
  return rest > 0 ? `${names.join(', ')} und ${rest} weitere` : names.join(', ')
}

export function formatAddressFull(a: Address): string {
  return a.name ? `${a.name} <${a.address}>` : a.address
}

/**
 * Wen die Liste zeigt: bei Gesendet und Entwuerfen interessiert der Empfaenger,
 * sonst der Absender.
 */
export function listPartner(msg: MessageSummary, folderRole?: string): string {
  if (folderRole === 'sent' || folderRole === 'drafts') {
    return msg.to.length ? addressList(msg.to, 2) : 'Kein Empfänger'
  }
  return displayName(msg.from[0])
}

const decimalFmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })

/** Dateigroesse wie im Explorer: "214 KB", "3,4 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${decimalFmt.format(bytes / (1024 * 1024))} MB`
}

export function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** Wandelt eine Eingabezeile wie "a@b.de, Max <m@c.de>" in Adressen um. */
export function parseAddresses(input: string): Address[] {
  return input
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const angle = /^(.*?)<([^>]+)>$/.exec(part)
      if (angle) {
        return { name: angle[1].trim().replace(/^["']|["']$/g, '') || undefined, address: angle[2].trim() }
      }
      return { address: part }
    })
    .filter((a) => a.address.includes('@'))
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

/** Ordnernamen eindeutschen, wo der Server englische Standardnamen liefert. */
export function folderLabel(name: string, role: string): string {
  switch (role) {
    case 'inbox':
      return 'Posteingang'
    case 'sent':
      return 'Gesendet'
    case 'drafts':
      return 'Entwürfe'
    case 'trash':
      return 'Papierkorb'
    case 'junk':
      return 'Spam'
    case 'archive':
      return 'Archiv'
    default:
      return name
  }
}

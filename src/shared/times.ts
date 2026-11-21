/** Ein Vorschlag fuer "spaeter": Zurueckstellen und geplanter Versand teilen sich die Liste. */
export interface TimePreset {
  id: 'hour' | 'evening' | 'tomorrow' | 'monday'
  /** Kurzer Name ohne Uhrzeit, fuer Menues, die den Zeitpunkt daneben zeigen */
  name: string
  /** Name mit Uhrzeit, fuer Auswahllisten ohne eigene Zeitspalte */
  label: string
  /** Zeitpunkt in ms */
  at: number
}

function atHour(base: Date, addDays: number, hour: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + addDays, hour, 0, 0, 0)
}

/** Ein Vorschlag, der in weniger als einer halben Stunde laege, lohnt sich nicht. */
const MIN_LEAD_MS = 30 * 60_000

/**
 * Vorschlaege relativ zu jetzt. "Heute Abend" gibt es nur bis eine halbe Stunde
 * vorher; "Montag" meint immer den naechsten, an einem Montag also den in einer
 * Woche.
 */
export function timePresets(now = new Date()): TimePreset[] {
  const presets: TimePreset[] = [
    { id: 'hour', name: 'In einer Stunde', label: 'In einer Stunde', at: now.getTime() + 3_600_000 }
  ]

  const evening = atHour(now, 0, 18).getTime()
  if (evening - now.getTime() >= MIN_LEAD_MS) {
    presets.push({ id: 'evening', name: 'Heute Abend', label: 'Heute Abend, 18 Uhr', at: evening })
  }
  presets.push({ id: 'tomorrow', name: 'Morgen früh', label: 'Morgen früh, 8 Uhr', at: atHour(now, 1, 8).getTime() })

  const untilMonday = (8 - now.getDay()) % 7 || 7
  // Ist morgen schon Montag, stuende derselbe Zeitpunkt zweimal da.
  if (untilMonday > 1) {
    presets.push({ id: 'monday', name: 'Montag', label: 'Montag, 8 Uhr', at: atHour(now, untilMonday, 8).getTime() })
  }
  return presets
}

/** Wert fuer ein <input type="datetime-local">, in Ortszeit. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

import { useState, type ReactNode } from 'react'
import { timePresets, type TimePreset } from '@shared/times'
import { upcomingTime } from '../../lib/format'
import { IconCalendarArrow, IconClock, IconMoon, IconSunrise } from '../icons'
import { MenuItem } from './Menu'

const presetIcons: Record<TimePreset['id'], ReactNode> = {
  hour: <IconClock />,
  evening: <IconMoon />,
  tomorrow: <IconSunrise />,
  monday: <IconCalendarArrow />
}

/**
 * Inhalt eines Menues "bis wann": die Vorschlaege mit ihrer Uhrzeit rechts,
 * darunter ein freier Zeitpunkt. Zurueckstellen und spaeteres Senden teilen es.
 */
export function TimeMenu({
  title,
  onPick,
  onAskCustom
}: {
  /** Ueberschrift im Menue, etwa "Zurückstellen bis" */
  title: string
  onPick: (at: number) => void
  /** "Zeitpunkt wählen …" */
  onAskCustom: () => void
}) {
  // Beim Oeffnen berechnet: so stimmt "In einer Stunde" auch nach einer Stunde Lesen.
  const [presets] = useState(() => timePresets())
  return (
    <>
      <div className="rv-menu-title" aria-hidden="true">
        {title}
      </div>
      {presets.map((preset) => (
        <MenuItem key={preset.id} icon={presetIcons[preset.id]} meta={upcomingTime(preset.at)} onSelect={() => onPick(preset.at)}>
          {preset.name}
        </MenuItem>
      ))}
      <div className="rv-menu-sep" role="separator" />
      <MenuItem icon={<IconCalendarArrow />} onSelect={onAskCustom}>
        Zeitpunkt wählen …
      </MenuItem>
    </>
  )
}

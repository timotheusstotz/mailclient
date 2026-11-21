import type { CSSProperties } from 'react'

export type Theme = 'light' | 'dark'

/** --surface-2 aus app.css: der Grund, auf dem Kontofarben als Tönung stehen. */
const SURFACE_2: Record<Theme, Rgb> = { light: [0xef, 0xf1, 0xf4], dark: [0x19, 0x1d, 0x24] }
const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]

type Rgb = [number, number, number]

/**
 * Die Farbe eines Kontos als Paar für Schiene, Ordnergruppe, Zeile und Stapel:
 * `--a` für Marken und Schrift, `--a-soft` als Tönung dahinter. Im dunklen
 * Thema wird die Farbe aufgehellt, im hellen abgedunkelt, damit sie auf dem
 * jeweiligen Grund lesbar bleibt (Rezept aus docs/design/liste/HANDOFF.md).
 *
 * `--a-ini` ist die Schrift der Initialen: die Kontofarbe, solange sie auf der
 * Tönung 4.5:1 erreicht, sonst die normale Schrift. Die Farbe wählt der Nutzer.
 */
export function accountTone(color: string, theme: Theme): CSSProperties {
  const base = parseHex(color)
  if (!base) return {}
  const a = theme === 'dark' ? mix(base, WHITE, 0.7) : mix(base, BLACK, 0.8)
  const soft = mix(base, SURFACE_2[theme], 0.18)
  const ini = contrast(a, soft) >= 4.5 ? toHex(a) : 'var(--ink)'
  return { '--a': toHex(a), '--a-soft': toHex(soft), '--a-ini': ini } as CSSProperties
}

function parseHex(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, '')
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
  if (!/^[0-9a-f]{6}$/i.test(full)) return null
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb
}

/** Wie color-mix(in srgb, a share, b). */
function mix(a: Rgb, b: Rgb, share: number): Rgb {
  return a.map((v, i) => Math.round(v * share + b[i] * (1 - share))) as Rgb
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

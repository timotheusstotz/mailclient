import type { Folder, FolderRole } from '@shared/types'

/** Die Standardordner in der Reihenfolge, in der sie in der Ordnerspalte stehen. */
const STANDARD_ROLES: FolderRole[] = ['inbox', 'archive', 'sent', 'drafts', 'junk', 'trash']

export interface FolderSplit {
  /** Posteingang, Archiv, Gesendet, Entwürfe, Spam, Papierkorb - die es im Konto gibt */
  standard: Folder[]
  /** Alles andere in der Reihenfolge des Servers */
  own: Folder[]
}

/** Teilt die sichtbaren Ordner eines Kontos in Standardordner und eigene. */
export function splitFolders(folders: Folder[]): FolderSplit {
  const visible = folders.filter((f) => f.selectable && !f.hidden)
  const standard: Folder[] = []
  for (const role of STANDARD_ROLES) {
    const match = visible.find((f) => f.role === role)
    if (match) standard.push(match)
  }
  const taken = new Set(standard)
  return { standard, own: visible.filter((f) => !taken.has(f)) }
}

export interface FolderRow {
  folder: Folder
  /** Einrückung, höchstens 3 Ebenen; tiefere stehen auf Ebene 3 */
  level: number
  /** Hat sichtbare Unterordner und damit einen Pfeil zum Ein- und Ausklappen */
  parent: boolean
}

/**
 * Die eigenen Ordner als eingerückter Baum. Eltern sind die Ordner, deren Pfad
 * plus Trennzeichen den Pfad des Kindes beginnt; fehlt ein Elternteil (nicht
 * wählbar oder ein Standardordner), steht das Kind eine Ebene höher.
 * Unterordner eines zugeklappten Ordners fallen weg.
 */
export function folderRows(own: Folder[], isOpen: (folder: Folder) => boolean): FolderRow[] {
  const ancestorsOf = (folder: Folder): Folder[] =>
    own.filter((other) => other !== folder && folder.path.startsWith(other.path + (other.delimiter || '/')))
  const rows: FolderRow[] = []
  for (const folder of own) {
    const ancestors = ancestorsOf(folder)
    if (ancestors.some((a) => !isOpen(a))) continue
    const parent = own.some((other) => other !== folder && other.path.startsWith(folder.path + (folder.delimiter || '/')))
    rows.push({ folder, level: Math.min(ancestors.length, 3), parent })
  }
  return rows
}

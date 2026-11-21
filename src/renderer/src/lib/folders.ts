import type { Folder } from '@shared/types'
import { folderLabel } from './format'

/** Wo ein Ordner im Menue steht: gewohnte Ziele vorn, Ablagen fuer Ausgemustertes hinten. */
const roleRank: Partial<Record<Folder['role'], number>> = { archive: 1, inbox: 2, sent: 4, junk: 5, trash: 6 }

/**
 * Die Ordner fuer "Verschieben": der aktuelle zuerst (nicht waehlbar), dann das
 * Archiv, der Posteingang, die eigenen Ordner nach Namen und am Ende Gesendet,
 * Spam und Papierkorb. Entwuerfe sind kein Ziel.
 */
export function moveChoices(folders: Folder[], currentPath?: string): Folder[] {
  const rank = (f: Folder): number => (f.path === currentPath ? 0 : (roleRank[f.role] ?? 3))
  return folders
    .filter((f) => f.selectable && !f.hidden && f.role !== 'drafts')
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        folderLabel(a.name, a.role).localeCompare(folderLabel(b.name, b.role), 'de', { sensitivity: 'base' })
    )
}

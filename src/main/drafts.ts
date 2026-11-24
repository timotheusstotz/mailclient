import type { AddressObject, ParsedMail } from 'mailparser'
import type { AccountId, Address, OutgoingMessage } from '@shared/types'

function addresses(field: AddressObject | AddressObject[] | undefined): Address[] {
  const groups = Array.isArray(field) ? field : field ? [field] : []
  return groups
    .flatMap((group) => group.value)
    .filter((entry) => entry.address)
    .map((entry) => (entry.name ? { name: entry.name, address: entry.address! } : { address: entry.address! }))
}

/** Liest einen gespeicherten Entwurf so zurueck, wie das Verfassen-Fenster ihn braucht. */
export function draftFromParsed(accountId: AccountId, parsed: ParsedMail): OutgoingMessage {
  const references = parsed.references
  return {
    accountId,
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    bcc: addresses(parsed.bcc),
    subject: parsed.subject ?? '',
    html: parsed.html || parsed.textAsHtml || '',
    text: parsed.text ?? '',
    attachments: parsed.attachments.map((att, index) => ({
      filename: att.filename || `anhang-${index + 1}`,
      content: (att.content as Buffer).toString('base64'),
      contentType: att.contentType || 'application/octet-stream'
    })),
    inReplyTo: parsed.inReplyTo || undefined,
    references: references ? (Array.isArray(references) ? references : [references]) : undefined
  }
}

/** Message-ID ohne spitze Klammern, wie findByMessageIds sie erwartet. */
export function bareMessageId(messageId: string): string {
  return messageId.replace(/^<|>$/g, '')
}

/*
  Ende-zu-Ende-Test gegen einen lokalen Mailserver (GreenMail in Docker).

    docker run -d --name mailclient-greenmail -p 3465:3465 -p 3993:3993 -p 8080:8080 \
      -e GREENMAIL_OPTS="-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.auth.disabled" \
      greenmail/standalone:2.1.3
    npm run build && node tests/e2e.mjs

  Der Test startet die App mit einem eigenen, leeren Datenverzeichnis und einem
  unsichtbaren Fenster - die echten Konten bleiben unberuehrt. Er legt zwei
  Postfaecher an (tim@ und anna@test.local), bespielt sie und bedient dann die
  Oberflaeche wie ein Mensch.
*/
import { _electron as electron } from 'playwright-core'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
process.removeAllListeners('warning')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shots = path.join(root, 'tests', 'shots')
fs.mkdirSync(shots, { recursive: true })

const HOST = '127.0.0.1'

/*
  Die App spricht IMAP ueber diesen Umweg statt direkt mit GreenMail. Er reicht
  die Bytes nur weiter, kann aber jede Richtung um `latency` ms verzoegern - so
  verhaelt sich der lokale Server wie einer im Internet, bei dem ein Abruf
  Sekunden dauert.
*/
const IMAP_PROXY_PORT = 3994
const imapProxy = { latency: 0, down: false }
const proxySockets = new Set()
const proxyServer = net.createServer((inbound) => {
  // "Server weg": jede neue Verbindung bricht sofort wieder ab.
  if (imapProxy.down) {
    inbound.destroy()
    return
  }
  const outbound = net.connect(3993, HOST)
  for (const socket of [inbound, outbound]) {
    proxySockets.add(socket)
    socket.on('close', () => proxySockets.delete(socket))
  }
  const pipe = (from, to) => {
    let chain = Promise.resolve()
    from.on('data', (chunk) => {
      const wait = imapProxy.latency
      chain = chain.then(() => new Promise((resolve) => setTimeout(resolve, wait))).then(() => {
        if (!to.destroyed) to.write(chunk)
      })
    })
    from.on('close', () => chain.then(() => to.destroy()))
    from.on('error', () => to.destroy())
  }
  pipe(inbound, outbound)
  pipe(outbound, inbound)
})
await new Promise((resolve) => proxyServer.listen(IMAP_PROXY_PORT, HOST, resolve))

/** Trennt alle Verbindungen der App zum Server und laesst keine neuen zu, bis `imapProxy.down` wieder false ist. */
function cutImap() {
  imapProxy.down = true
  for (const socket of proxySockets) socket.destroy()
}
const TIM = 'tim@test.local'
const ANNA = 'anna@test.local'
const only = process.argv.slice(2)

// ------------------------------------------------------------ Hilfsmittel

const results = []
async function check(name, fn) {
  if (only.length && !only.some((o) => name.toLowerCase().includes(o.toLowerCase()))) return
  const started = Date.now()
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  ok    ${name} (${Date.now() - started} ms)`)
  } catch (err) {
    results.push({ name, ok: false, error: err.message })
    console.log(`  FEHLER ${name}\n         ${String(err.message).split('\n').join('\n         ')}`)
    await shot(`fehler-${name.replace(/[^a-z0-9]+/gi, '-')}`)
  }
  await reset()
}

/** Bildschirmfoto fuer die Durchsicht. Scheitert es (unsichtbares Fenster), ist das kein Testfehler. */
async function shot(name) {
  // Ueber Electron selbst: Playwrights Bildschirmfoto bleibt am unsichtbaren Fenster haengen.
  try {
    const png = await Promise.race([
      app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        // Das unsichtbare Fenster zeichnet nicht von selbst neu; ohne Anstoss kaeme ein altes Bild.
        win.webContents.invalidate()
        await new Promise((resolve) => setTimeout(resolve, 200))
        const image = await win.webContents.capturePage(undefined, { stayHidden: true })
        return image.toPNG().toString('base64')
      }),
      sleep(5000).then(() => null)
    ])
    if (png) fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(png, 'base64'))
  } catch {
    /* ein fehlendes Bild ist kein Testfehler */
  }
}

/** Zurueck in den Sammelposteingang, ohne offenen Dialog und ohne Suchbegriff. */
async function reset() {
  if (!page) return
  try {
    // Fenster aus der Leiste schliessen (sichert sie); ein zweiter Klick schliesst auch nach einem Fehler.
    const bar = page.getByRole('navigation', { name: 'Offene Fenster' })
    for (let i = 0; i < 8 && (await bar.count()); i++) {
      await bar.getByRole('button', { name: /^Schließen/ }).first().click({ timeout: 2000 }).catch(() => {})
      await sleep(300)
    }
    for (let i = 0; i < 3 && (await page.locator('.overlay, .menu-backdrop, [role="menu"]').count()); i++) {
      await page.keyboard.press('Escape')
      const done = page.locator('.dialog-foot .btn-primary', { hasText: 'Fertig' })
      // Direkt geklickt: das unsichtbare Fenster zeichnet nicht immer, dann wartet Playwright vergeblich auf Stillstand.
      if (await done.count()) await done.evaluate((el) => el.click()).catch(() => {})
      await sleep(150)
    }
    if (await searchBox().count()) {
      if (await searchBox().inputValue()) await search('')
      // Aus einem Kontoordner zurueck in die Sammelansicht - nur dort stehen deren Eintraege.
      await railButton('Alle Konten').click({ timeout: 2000 })
      await folderItem('Posteingang').click({ timeout: 2000 })
    }
  } catch {
    /* der naechste Test meldet, was nicht stimmt */
  }
}

/*
  Neu laden und warten, bis die Liste steht. Danach zeichnet das unsichtbare
  Fenster nicht immer von selbst weiter; ohne neue Bilder wartet Playwright
  vergeblich darauf, dass ein Knopf stillsteht. Ein invalidate stoesst es an.
*/
async function reloadPage() {
  await page.reload()
  await page.waitForSelector('.lv-r', { timeout: 60000 })
  const frame = () =>
    page.evaluate(() => Promise.race([new Promise((r) => requestAnimationFrame(() => r(true))), new Promise((r) => setTimeout(() => r(false), 500))]))
  if (await frame()) return
  console.log('         (nach dem Neuladen keine Bilder; neu angestossen)')
  await until(async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.invalidate())
    return frame()
  }, 'das Fenster zeichnet nach dem Neuladen nicht mehr')
}

async function openSettings(tab) {
  // Ist der Dialog vom vorigen Schritt noch offen, genuegt der Reiter.
  if (!(await page.locator('.tabs').count())) {
    await railButton('Einstellungen').click()
    await page.waitForSelector('.tabs')
  }
  await page.locator('.tab', { hasText: tab }).click()
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(fn, message, timeout = 15000) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    try {
      last = await fn()
      if (last) return last
    } catch (err) {
      last = err
    }
    await sleep(200)
  }
  throw new Error(`${message} (zuletzt: ${last instanceof Error ? last.message : JSON.stringify(last)})`)
}

async function imap(user) {
  const client = new ImapFlow({
    host: HOST,
    port: 3993,
    secure: true,
    auth: { user, pass: 'geheim' },
    logger: false,
    tls: { rejectUnauthorized: false }
  })
  client.on('error', () => {})
  await client.connect()
  return client
}

/** Betreffzeilen eines Ordners, direkt vom Server. */
async function subjects(user, folder = 'INBOX') {
  const client = await imap(user)
  try {
    const lock = await client.getMailboxLock(folder)
    try {
      const out = []
      if (client.mailbox.exists) {
        for await (const msg of client.fetch('1:*', { envelope: true, flags: true })) {
          out.push({ subject: msg.envelope.subject, seen: msg.flags.has('\\Seen'), flagged: msg.flags.has('\\Flagged') })
        }
      }
      return out
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }
}

/** Mails eines Ordners mit Quelltext und Flags, direkt vom Server. */
async function folderMails(user, folder) {
  const client = await imap(user)
  try {
    const lock = await client.getMailboxLock(folder)
    try {
      const out = []
      if (client.mailbox.exists) {
        for await (const msg of client.fetch('1:*', { envelope: true, flags: true, source: true })) {
          out.push({ subject: msg.envelope.subject ?? '', draft: msg.flags.has('\\Draft'), source: msg.source.toString() })
        }
      }
      return out
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }
}

async function clearFolder(user, folder) {
  const client = await imap(user)
  try {
    const lock = await client.getMailboxLock(folder)
    try {
      if (client.mailbox.exists) await client.messageDelete('1:*')
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }
}

const builder = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' })
async function raw(options) {
  return (await builder.sendMail(options)).message
}

const mail = (from, to, subject, extra = {}) => ({
  from: `${from.split('@')[0]} <${from}>`,
  to,
  subject,
  text: extra.text ?? `Text von ${subject}`,
  ...extra
})

// ------------------------------------------------------ Vergleichsbilder

/*
  Bilder des Lesebereichs fuer den Vergleich mit dem Entwurf in
  docs/design/leseansicht: jeder Zustand dunkel und hell, bei 1440x900 und
  2200x1100, dazu das schmale Fenster (1120). Sie landen als port-*.png in
  tests/shots.
*/
const PORT_SIZES = [
  [1440, 900],
  [2200, 1100]
]

async function setTheme(theme) {
  await page.evaluate((t) => window.api.settings.update({ theme: t }), theme)
  await until(() => page.evaluate((t) => document.documentElement.dataset.theme === t, theme), `Thema ${theme} kommt nicht an`)
}

/** Ein Zustand in allen Varianten; `ready` wird nach jedem Wechsel abgewartet. */
async function portVariants(name, { sizes = PORT_SIZES, ready = () => sleep(500), prefix = 'port' } = {}) {
  for (const theme of ['dark', 'light']) {
    await setTheme(theme)
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height })
      await ready()
      await shot(`${prefix}-${name}-${theme === 'dark' ? 'dunkel' : 'hell'}-${width}`)
    }
  }
}

/** Dasselbe fuer die linke Seite (docs/design/liste): list-*.png */
const listVariants = (name, options = {}) => portVariants(name, { ready: () => sleep(800), ...options, prefix: 'list' })

/*
  Bilder der linken Seite fuer den Vergleich mit dem Entwurf in docs/design/liste.
  Dazu kommen zwei Konten: "Anna" (ein zweites Postfach, damit die
  Sammelansicht Konten mischt) und zuletzt "Web" an einem Port, an dem niemand
  lauscht - fuer den Fehler in Schiene, Ordnerspalte und Unterzeile. Beide
  gehen am Ende wieder.
*/
async function listShots() {
  const before = await page.evaluate(() => window.api.settings.get())
  const still = await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
  const added = []
  const addAccount = async (label, email, color, port) => {
    await page.evaluate(
      ([label, email, color, host, port]) =>
        window.api.accounts.save({
          label,
          displayName: label,
          email,
          color,
          imap: { host, port, secure: true },
          smtp: { host, port: 3465, secure: true },
          username: email,
          signature: '',
          enabled: true,
          password: 'geheim'
        }),
      [label, email, color, HOST, port]
    )
    const id = await until(
      () => page.evaluate((email) => window.api.accounts.list().then((list) => list.find((a) => a.email === email)?.id), email),
      `Konto ${label} kommt nicht an`
    )
    added.push(id)
    return id
  }
  const idle = (timeout = 90000) =>
    until(
      () => page.evaluate(() => window.api.accounts.statuses().then((s) => s.every((x) => x.phase === 'idle' || x.phase === 'error'))),
      'Konten kommen nicht zur Ruhe',
      timeout
    )
  const unified = async (label) => {
    await railButton('Alle Konten').click()
    await folderItem(label).click()
    await sleep(400)
  }
  try {
    const anna = await imap(ANNA)
    await anna.append('INBOX', await raw(mail('kasse@theater.example', ANNA, 'Tickets für Samstag', { text: 'Ihre Karten für die Vorstellung am Samstag liegen bei.', attachments: [{ filename: 'tickets.pdf', content: Buffer.from('%PDF-1.4 test'), contentType: 'application/pdf' }] })), ['\\Seen'])
    await anna.append('INBOX', await raw(mail(TIM, ANNA, 'Abgabe Freitag', { text: 'Bis Freitag bitte.' })), [])
    await anna.logout()
    await addAccount('Anna', ANNA, '#e0723c', IMAP_PROXY_PORT)
    await until(async () => (await rowTexts()).includes('Tickets für Samstag'), 'Annas Post kommt nicht in die Sammelansicht', 60000)
    await idle()

    await unified('Posteingang')
    await rowBySubject('Teammeeting').click()
    // Das erste Bild nach langer Pause liefert im unsichtbaren Fenster oft noch einen alten Stand.
    await shot('list-aufwaermen')
    fs.rmSync(path.join(shots, 'list-aufwaermen.png'), { force: true })
    await listVariants('sammel')

    await railButton(`Test · ${TIM}`).click()
    await rowBySubject('Rechnung 4711').click()
    await listVariants('konto')

    await page.evaluate(() => window.api.settings.update({ density: 'compact' }))
    await unified('Posteingang')
    await rowBySubject('Teammeeting').click()
    await listVariants('kompakt')
    await page.evaluate(() => window.api.settings.update({ density: 'comfortable' }))

    await rowBySubject('Abgabe Freitag').click()
    await rowBySubject('Teammeeting').click({ modifiers: ['Control'] })
    await rowBySubject('Rechnung 4711').click({ modifiers: ['Control'] })
    await listVariants('mehrfach')
    await page.keyboard.press('Escape')

    await searchBox().click()
    await page.getByRole('listbox', { name: 'Suchkürzel' }).waitFor()
    await listVariants('suche-hilfe')
    await page.keyboard.press('Escape')

    await search('von:anna')
    await rowBySubject('Teammeeting').click()
    await listVariants('suche-treffer')

    await search('von:anna datei:vertrag')
    await listRegion().getByRole('heading', { name: 'Keine Treffer' }).first().waitFor()
    await listVariants('leer-suche')
    await search('')

    // Fruehere Pruefungen hinterlassen Entwuerfe (Esc speichert); hier soll der Ordner leer sein.
    await clearFolder(TIM, 'Drafts')
    await railButton(`Test · ${TIM}`).click()
    await folderItem('Entwürfe').click()
    await page.evaluate(() => window.api.accounts.list().then((a) => window.api.sync.refresh(a[0].id, 'Drafts')))
    await page.getByText('Keine Entwürfe').waitFor()
    await listVariants('leer-ordner')

    await page.evaluate(() =>
      window.api.messages.list({ kind: 'unified', id: 'inbox' }).then((list) => {
        const pick = list.filter((m) => ['Teammeeting', 'Rechnung 4711', 'Abgabe Freitag'].includes(m.subject))
        // Nacheinander: die Ablage schreibt snoozes.json bei jedem Aufruf neu.
        return pick.reduce((chain, m, i) => chain.then(() => window.api.messages.snooze([m], Date.now() + (i + 1) * 26 * 3_600_000)), Promise.resolve())
      })
    )
    await unified('Zurückgestellt')
    await until(async () => (await rowTexts()).length >= 3, 'Zurückgestelltes fehlt')
    await rowBySubject('Teammeeting').click()
    await listVariants('zurueckgestellt')
    await page.evaluate(() =>
      window.api.messages.list({ kind: 'unified', id: 'snoozed' }).then((list) => window.api.messages.unsnooze(list))
    )

    await page.evaluate(() => window.api.messages.markRead({}))
    await unified('Ungelesen')
    await page.getByText('Alles gelesen').waitFor({ timeout: 20000 })
    await listVariants('alles-gelesen')

    await unified('Posteingang')
    await rowBySubject('Teammeeting').click()
    await listVariants('schmal', { sizes: [[1120, 900]] })
    await listRegion().getByRole('button', { name: 'Posteingang', exact: true }).click()
    await page.getByRole('menu', { name: 'Ordner' }).waitFor()
    await listVariants('schmal-ordner', { sizes: [[1120, 900]] })
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1440, height: 900 })

    // Ein drittes Konto, dessen Server nicht antwortet.
    await addAccount('Web', 'tim@web.example', '#3fa06b', 3999)
    await until(
      () => page.evaluate(() => window.api.accounts.statuses().then((s) => JSON.stringify(s.map((x) => x.phase + ':' + (x.message ?? '')))).then((s) => (/error|offline/.test(s) ? true : s))),
      'das Konto ohne Server meldet keinen Fehler',
      60000
    )
    await unified('Posteingang')
    await rowBySubject('Teammeeting').click()
    await listVariants('fehler')
  } finally {
    for (const id of added) await page.evaluate((id) => window.api.accounts.remove(id), id).catch(() => {})
    await still.evaluate((el) => el.remove())
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate((s) => window.api.settings.update({ theme: s.theme, density: s.density }), before)
  }
}

async function openForShot(subject) {
  await rowBySubject(subject).first().click()
  await page.waitForSelector('.rv-subject')
  await sleep(600)
}

async function portShots() {
  const before = await page.evaluate(() => window.api.settings.get())
  // Im unsichtbaren Fenster laufen Uebergaenge nicht weiter; die Bilder zeigen den Endzustand.
  const still = await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
  try {
    // Eine Mail mit allem: zurueckgestellt, externe Bilder, zwei Anhaenge.
    const tim = await imap(TIM)
    const remote = (w, h) => `<img src="https://bilder.deutschebahn.example/${w}x${h}.png" width="${w}" height="${h}" alt="">`
    await tim.append('INBOX', await raw(mail('noreply@deutschebahn.example', TIM, 'Buchungsbestätigung Deutsche Bahn (Auftrag: 970486644102)', {
      html: `<div style="padding:32px 40px;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#282d37;max-width:720px">${remote(72, 48)}
        <div style="font-size:24px;font-weight:700;margin-top:24px">Buchungsbestätigung</div>
        <p>Vielen Dank für Ihre Buchung. Ihr Ticket finden Sie im Anhang dieser E-Mail.</p>
        <table style="width:100%;border-collapse:collapse;margin-top:20px"><tr><td style="color:#646973;padding:10px 0;border-top:1px solid #e4e7eb">Auftragsnummer</td><td style="text-align:right;font-weight:700;border-top:1px solid #e4e7eb">970486644102</td></tr>
        <tr><td style="color:#646973;padding:10px 0;border-top:1px solid #e4e7eb">Hinfahrt</td><td style="text-align:right;font-weight:700;border-top:1px solid #e4e7eb">Mo., 23.11.2026</td></tr></table>
        ${remote(600, 140)}${remote(1, 1)}</div>`,
      attachments: [
        { filename: 'Ticket_970486644102.pdf', content: Buffer.alloc(214 * 1024, 1), contentType: 'application/pdf' },
        { filename: 'Reise_23-11-2026.ics', content: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'.repeat(60), contentType: 'text/calendar' }
      ]
    })), ['\Seen'])
    // Die Rundmail legt sonst ein Test der Leseansicht an; laeuft nur ein Teil der Tests, fehlt sie.
    if (!(await subjects(TIM)).some((m) => m.subject === 'Rundmail mit Anlagen')) {
      const files = Array.from({ length: 9 }, (_, i) => ({ filename: `anlage-${i + 1}.txt`, content: `Inhalt ${i + 1}`, contentType: 'text/plain' }))
      await tim.append('INBOX', await raw(mail(ANNA, TIM, 'Rundmail mit Anlagen', { cc: 'jonas@test.local, lea@test.local', attachments: files })), [])
    }
    await tim.logout()
    await page.evaluate(() => window.api.sync.refresh())
    await until(async () => (await rowBySubject('Buchungsbestätigung').count()) === 1, 'Mail mit Hinweisen kommt nicht an', 30000)
    await until(async () => (await rowBySubject('Rundmail mit Anlagen').count()) === 1, 'Rundmail kommt nicht an', 30000)

    await openForShot('Layout-Test')
    await portVariants('mail')
    await barButton('Zurückstellen').click()
    await portVariants('menue-zurueckstellen')
    await page.keyboard.press('Escape')
    await barButton('Verschieben').click()
    await portVariants('menue-verschieben')
    await page.keyboard.press('Escape')

    await openForShot('Projektplan')
    await until(async () => (await threadRows().count()) === 3, 'Verlauf fehlt')
    await portVariants('unterhaltung')

    await openForShot('Rundmail mit Anlagen')
    await portVariants('rundmail')

    await page.evaluate(() =>
      window.api.messages.list({ kind: 'unified', id: 'inbox' }).then((list) => {
        const target = list.find((m) => m.subject.startsWith('Buchungsbestätigung'))
        return window.api.messages.snooze([target], Date.now() + 7 * 86_400_000)
      })
    )
    await folderItem('Zurückgestellt').click()
    await openForShot('Buchungsbestätigung')
    await portVariants('hinweise')
    await portVariants('schmal-hinweise', { sizes: [[1120, 900], [1200, 900]] })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'Jetzt zurückholen' }).click()
    await folderItem('Posteingang').click()

    await openForShot('Projektplan')
    await portVariants('schmal-unterhaltung', { sizes: [[1120, 900], [1200, 900]] })
    await page.setViewportSize({ width: 1440, height: 900 })

    await openForShot('Zoom-Test')
    await barButton('Als ungelesen markieren').click()
    await page.getByText('Keine Nachricht ausgewählt').waitFor()
    await portVariants('leer')

    // Laden: ein langsamer Server haelt die grauen Zeilen lange genug fuer alle Varianten.
    await search('betreff:"fuellmail 123"')
    imapProxy.latency = 2500
    try {
      await rowBySubject('Fuellmail 123').click()
      await page.waitForSelector('.rv-sk-lines')
      await portVariants('laden', { ready: () => sleep(150) })
    } finally {
      imapProxy.latency = 0
    }
    await until(async () => (await page.locator('.rv-plain').count()) === 1, 'Text nach dem Laden fehlt', 30000)

    await search('betreff:"fuellmail 124"')
    await rowBySubject('Fuellmail 124').waitFor()
    cutImap()
    try {
      await sleep(400)
      await rowBySubject('Fuellmail 124').click()
      await page.getByRole('alert').waitFor({ timeout: 20000 })
      await portVariants('fehler', { ready: () => sleep(300) })
    } finally {
      imapProxy.down = false
    }
    await search('')
  } finally {
    await still.evaluate((el) => el.remove())
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate((theme) => window.api.settings.update({ theme }), before.theme)
    await until(
      () => page.evaluate(() => window.api.accounts.statuses().then((s) => s.every((x) => x.phase === 'idle'))),
      'Konto kommt nach den Bildern nicht zur Ruhe',
      90000
    )
  }
}

/** Legt Dateien auf das aufgeklappte Fenster, als kaemen sie aus dem Explorer. */
async function dropFiles(files) {
  await page.evaluate((list) => {
    const data = new DataTransfer()
    for (const f of list) data.items.add(new File([new Uint8Array(f.size)], f.name, { type: f.type }))
    const target = document.querySelector('.compose-dialog:not([hidden])')
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }))
    }
  }, files)
}

/*
  Bilder der Fenster fuer den Vergleich mit dem Entwurf in docs/design/verfassen:
  port-verfassen, port-leiste (und die weiteren, sobald es sie gibt), dunkel,
  1440 x 900. Die Bewegungen sind dabei abgeschaltet.
*/
/** Ein Bild nach einem frischen Frame: eine kurze Groessenaenderung zwingt das unsichtbare Fenster zu zeichnen. */
async function freshShot(name) {
  await page.setViewportSize({ width: 1441, height: 900 })
  await page.setViewportSize({ width: 1440, height: 900 })
  await sleep(400)
  await shot(name)
}

async function windowShots() {
  const before = await page.evaluate(() => window.api.settings.get())
  const still = await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
  try {
    await setTheme('dark')
    await page.setViewportSize({ width: 1440, height: 900 })
    await clearFolder(TIM, 'Drafts')

    await openComposer()
    await fillComposer({
      to: 'rueckforderung-prime@amazon.example',
      subject: 'Antrag auf Rückerstattung zu viel gezahlter Prime-Beiträge nach dem BGH-Urteil vom 12. November 2026 (bitte Kundennummer und Zeitraum angeben)',
      body: ['Guten Tag,', '', 'hiermit beantrage ich die Erstattung der zu viel gezahlten Prime-Beiträge.', '', 'Kundennummer: 302-4471185-9920'].join('\n')
    })
    await dropFiles([
      { name: 'Kontoauszüge_Prime_2023-2026.pdf', size: 412 * 1024, type: 'application/pdf' },
      { name: 'Übersicht.txt', size: 1200 * 1024, type: 'text/plain' }
    ])
    await composeOpen().getByRole('button', { name: /Kontoauszüge.*entfernen/ }).waitFor()
    await composeOpen().getByRole('button', { name: 'Als Entwurf speichern' }).click()
    await page.getByRole('status').filter({ hasText: 'Entwurf gespeichert' }).waitFor()
    await freshShot('port-verfassen')

    // Drei Fenster in der Leiste: zwei Entwuerfe und das eben geschriebene.
    await page.mouse.click(8, 450)
    await windowBar().getByRole('button', { name: /^Antrag auf/ }).waitFor()
    await openComposer()
    await page.mouse.click(8, 450)
    await until(async () => (await windowBar().getByRole('group').count()) === 2, 'zweiter Reiter fehlt')
    await windowBar().getByRole('group').nth(1).getByRole('button', { name: /^Schließen/ }).hover()
    await sleep(700)
    await freshShot('port-leiste')

    // Speichern scheitert: das erste Fenster zurueck, geaendert, das Konto offline.
    await windowBar().getByRole('button', { name: /^Antrag auf/ }).click()
    await page.click('.compose-editor:visible')
    await page.keyboard.press('Control+End')
    await page.keyboard.type(' Bitte bestätigen Sie mir kurz den Eingang.')
    cutImap()
    try {
      await composeOpen().getByRole('button', { name: 'Schließen', exact: true }).click()
      await composeOpen().getByRole('alert').waitFor({ timeout: 30000 })
      await freshShot('port-fehler')
    } finally {
      imapProxy.down = false
    }
    // Wieder verbunden: der Entwurf geht ueber die App in den Papierkorb, so weiss auch ihre Liste davon.
    await until(
      () => page.evaluate(() => window.api.accounts.statuses().then((s) => s.every((x) => x.phase === 'idle'))),
      'Konto kommt nach der Unterbrechung nicht zur Ruhe',
      90000
    )
    // Schliessen statt Verwerfen: Verworfenes laege im Papierkorb und taete in spaeteren Suchen auf.
    // Wieder online speichert der Klick; ist das X noch scharf, schliesst er ohne Speichern.
    await composeOpen().getByRole('button', { name: /^Schließen/ }).click()
    await until(async () => (await composeOpen().count()) === 0, 'Schliessen schliesst nicht')

    // Eine Mail mit Anhang im eigenen Fenster; der Entwurf ohne Betreff liegt weiter in der Leiste.
    await rowBySubject('Rechnung 4711').first().dblclick()
    const mailWindow = page.getByRole('dialog', { name: 'Rechnung 4711' })
    await mailWindow.getByRole('region', { name: 'Anhänge' }).waitFor()
    await sleep(600)
    await freshShot('port-mail-fenster')
    await page.keyboard.press('Escape')
    await windowBar().getByRole('button', { name: /^Schließen/ }).click()
    await until(async () => (await windowBar().count()) === 0, 'Leiste bleibt stehen')

    // Entwuerfe: einer mit Empfaenger und Anhang, einer ohne Empfaenger und Betreff.
    await clearFolder(TIM, 'Drafts')
    await page.evaluate(() =>
      window.api.accounts.list().then(async (accounts) => {
        const base = { accountId: accounts[0].id, cc: [], bcc: [], attachments: [] }
        await window.api.drafts.save({ ...base, to: [], subject: '', html: '<p>Hallo Jana, wegen Samstag: Ich bringe den Beamer mit, das Kabel fehlt aber noch.</p>', text: 'Hallo Jana, wegen Samstag: Ich bringe den Beamer mit, das Kabel fehlt aber noch.' })
        await window.api.drafts.save({
          ...base,
          to: [{ address: 'rueckforderung-prime@amazon.example' }],
          subject: 'Erstattung der Prime-Beiträge, Kundennummer 302-4471185',
          html: '<p>Guten Tag,</p><p>hiermit beantrage ich die Erstattung der zu viel gezahlten Prime-Beiträge.</p>',
          text: 'Guten Tag, hiermit beantrage ich die Erstattung der zu viel gezahlten Prime-Beiträge.',
          attachments: [{ filename: 'Kontoauszüge_Prime_2023-2026.pdf', content: btoa('x'.repeat(3000)), contentType: 'application/pdf' }]
        })
      })
    )
    await railButton(`Test · ${TIM}`).click()
    await folderItem('Entwürfe').click()
    // Was clearFolder am Server entfernt hat, erfaehrt die App erst beim naechsten Abruf.
    await page.evaluate(() => window.api.sync.refresh())
    await until(async () => (await rowBySubject('Erstattung der Prime').count()) === 1, 'Entwurf fehlt in der Liste')
    await rowBySubject('Erstattung der Prime').click()
    await page.getByText(/^Entwurf, noch nicht gesendet/).waitFor()
    await sleep(600)
    await freshShot('port-entwurf')
    await railButton('Alle Konten').click()
    await folderItem('Posteingang').click()
    await clearFolder(TIM, 'Drafts')
    // Sonst kennt die App die beiden noch und spaetere Suchen faenden sie.
    await page.evaluate(() => window.api.accounts.list().then((a) => window.api.sync.refresh(a[0].id, 'Drafts')))
  } finally {
    await still.evaluate((el) => el.remove())
    await page.evaluate((theme) => window.api.settings.update({ theme }), before.theme)
  }
}

// ---------------------------------------------------------------- Bestand

async function seed() {
  await fetch('http://localhost:8080/api/mail/purge', { method: 'POST' })
  const tim = await imap(TIM)
  const anna = await imap(ANNA)
  await anna.logout()

  // Dazu Gmails Sichten: dort liegen Kopien, die nie doppelt erscheinen duerfen.
  const folders = ['Sent', 'Trash', 'Archive', 'Drafts', 'Arbeit', '[Gmail]/All Mail', '[Gmail]/Important', '[Gmail]/Starred']
  for (const folder of folders) {
    await tim.mailboxCreate(folder).catch(() => {})
  }
  // Reste frueherer Laeufe aus den Nebenordnern entfernen.
  for (const folder of ['INBOX', ...folders]) {
    const lock = await tim.getMailboxLock(folder)
    try {
      if (tim.mailbox.exists) await tim.messageDelete('1:*')
    } finally {
      lock.release()
    }
  }

  const now = Date.now()
  const at = (minutesAgo) => new Date(now - minutesAgo * 60_000)
  const put = async (folder, options, flags = []) =>
    tim.append(folder, await raw(options), flags, options.date)

  // Eine alte Unterhaltung, deren Anfang ausserhalb des lokal geholten Fensters liegt:
  // danach kommen mehr als 200 Fuellmails.
  await put('INBOX', mail(ANNA, TIM, 'Altes Thema', { messageId: '<alt-1@test.local>', date: new Date('2019-03-01T10:00:00Z'), text: 'Der Anfang der alten Unterhaltung.' }), ['\\Seen'])
  for (let i = 0; i < 205; i++) {
    await put('INBOX', mail('fuell@test.local', TIM, `Fuellmail ${i}`, { date: new Date(Date.UTC(2021, 0, 1, 0, i)) }), ['\\Seen'])
  }

  // Unterhaltung ueber Posteingang und Gesendet.
  await put('INBOX', mail(ANNA, TIM, 'Projektplan', { messageId: '<plan-1@test.local>', date: at(300), text: 'Hier ist der Projektplan.' }), ['\\Seen'])
  await put('Sent', mail(TIM, ANNA, 'Re: Projektplan', { messageId: '<plan-2@test.local>', inReplyTo: '<plan-1@test.local>', references: ['<plan-1@test.local>'], date: at(240), text: 'Danke, ich schaue ihn mir an - Antwort von Tim.' }), ['\\Seen'])
  await put('INBOX', mail(ANNA, TIM, 'Re: Projektplan', { messageId: '<plan-3@test.local>', inReplyTo: '<plan-2@test.local>', references: ['<plan-1@test.local>', '<plan-2@test.local>'], date: at(200), text: 'Super, dann bis Montag.' }))

  await put('INBOX', mail(ANNA, TIM, 'Re: Altes Thema', { messageId: '<alt-2@test.local>', inReplyTo: '<alt-1@test.local>', references: ['<alt-1@test.local>'], date: at(180), text: 'Nachtrag zum alten Thema.' }), ['\\Seen'])

  await put('INBOX', mail('buchhaltung@firma.example', TIM, 'Rechnung 4711', { date: at(120), text: 'Im Anhang die Rechnung.', attachments: [{ filename: 'rechnung-4711.pdf', content: Buffer.from('%PDF-1.4 test'), contentType: 'application/pdf' }] }), ['\\Seen'])
  await put('INBOX', mail('news@shop.example', TIM, 'Newsletter Herbst', { date: at(90), text: 'Neue Angebote im Herbst.' }), ['\\Seen'])
  await put('INBOX', mail(ANNA, TIM, 'Mittagessen', { date: at(60), text: 'Gehen wir morgen essen?' }))
  await put('INBOX', mail('chef@firma.example', TIM, 'Bitte um Rueckruf', { date: at(30), text: 'Ruf mich bitte an.' }), ['\\Seen'])
  await put('INBOX', mail('ablage@firma.example', TIM, 'Verschiebe-Test', { date: at(15), text: 'Diese Mail zieht in einen anderen Ordner.' }), ['\\Seen'])

  // Eine Mail mit Gmail-Label: dieselbe Nachricht im Posteingang, im Label-Ordner
  // und in den Sichten "Alle Nachrichten" und "Wichtig".
  // Eine HTML-Mail mit Bild, die breiter ist als das Blatt erlaubt - zum Vergroessern.
  const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg=='
  await put('INBOX', mail('galerie@firma.example', TIM, 'Zoom-Test', {
    date: at(20),
    html: `<p id="zoom-text">Text zum Vergroessern.</p><img id="zoom-img" src="data:image/png;base64,${pixel}" width="300" height="200">`
  }), ['\\Seen'])

  // Ein Newsletter, wie er wirklich aussieht: eine zentrierte Tabelle mit fester Breite.
  const banner = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN89p/hPwAHGQLo1PnhtAAAAABJRU5ErkJggg=='
  await put('INBOX', mail('shop@firma.example', TIM, 'Layout-Test', {
    date: at(19),
    html: `<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5"><tr><td align="center" style="padding:24px 0">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff"><tr><td>
        <img src="data:image/png;base64,${banner}" width="600" height="220" style="display:block">
        <h1 style="font-family:Arial;margin:20px 24px 8px">Herbstangebote</h1>
        <p style="font-family:Arial;margin:0 24px 24px;line-height:1.5">Alles fuer den Garten, solange der Vorrat reicht. Dieser Absatz ist lang genug, um umzubrechen, damit man sieht, wie sich der Text beim Vergroessern verhaelt.</p>
      </td></tr></table>
    </td></tr></table>`
  }), ['\\Seen'])

  // Reiner Fliesstext als HTML: der soll beim Vergroessern umbrechen, nicht seitlich weglaufen.
  await put('INBOX', mail('autor@firma.example', TIM, 'Fliesstext-Test', {
    date: at(18),
    html: `<p id="flow">${'Ein ganz gewoehnlicher Satz, der sich ueber viele Zeilen zieht. '.repeat(30)}</p>`
  }), ['\\Seen'])

  await put('INBOX', mail('shop@firma.example', TIM, 'Zieh-Test', { date: at(17), text: 'Diese Mail wird in einen Ordner gezogen.' }), ['\\Seen'])

  const meeting = mail(ANNA, TIM, 'Teammeeting', { messageId: '<meeting@test.local>', date: at(45), text: 'Morgen um zehn.' })
  for (const folder of ['INBOX', 'Arbeit', '[Gmail]/All Mail', '[Gmail]/Important']) await put(folder, meeting)
  await put('[Gmail]/All Mail', mail(ANNA, TIM, 'Nur in Alle Nachrichten', { date: at(40) }))
  await tim.logout()
}

// -------------------------------------------------------------------- App

let app
let page

/** Liste, Zeilen, Ordner und Schiene, ueber Rolle und Namen. */
const messageList = () => page.getByRole('listbox', { name: 'Nachrichtenliste' })
const listRegion = () => page.getByRole('region', { name: 'Nachrichten', exact: true })
const rowBySubject = (text) => messageList().getByRole('option').filter({ has: page.locator('.lv-r-subj', { hasText: text }) })
const rowTexts = () => messageList().locator('.lv-r-subj').allTextContents()
const threadCount = (row) => row.getByTitle(/^Unterhaltung mit \d+ Nachrichten$/)
const folderColumn = () => page.getByRole('complementary', { name: 'Ordner' })
/** Ein Ordner oder eine Sammelansicht; der Name endet mit der Zahl, falls eine dasteht. */
const folderItem = (label) => folderColumn().getByRole('button', { name: new RegExp(`^${label} ?\\d*$`) }).first()
const railButton = (name) => page.getByRole('navigation', { name: 'Konten' }).getByRole('button', { name, exact: true })
const searchBox = () => page.getByRole('combobox', { name: 'Nachrichten durchsuchen' })
const listSplitter = () => page.getByRole('separator', { name: /^(Breite|Höhe) der Liste$/ })
const toast = () => page.locator('.toast')
/** Das Briefchen am Zeiger beim Ziehen; es ist nur Zierde (aria-hidden), darum ueber seine Klasse. */
const dragToken = () => page.locator('[data-drag-token]')
/** Wohin das Briefchen am Zeiger gerade will: der Zeiger, auf den es ausgerichtet ist (ohne den Nachlauf). */
async function tokenAt() {
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec((await dragToken().getAttribute('style')) ?? '')
  return m ? { x: Number(m[1]) - 12, y: Number(m[2]) - 10 } : null
}
/**
 * Von Playwrights schnellen Schritten kommt beim Ziehen nicht jeder als
 * dragover an, oft auch der letzte nicht (beobachtet: das Briefchen blieb auf
 * halbem Weg). Eine echte Maus meldet sich beim Stillhalten weiter, hier tut
 * das ein zweiter Zug nach einer kurzen Pause.
 */
async function holdStill(x, y) {
  await sleep(80)
  await page.mouse.move(x, y)
}
const near = (a, b) => Boolean(a && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2)
/**
 * Merkt sich im Fenster, ob ein fliegendes Briefchen erscheint; vor der Aktion
 * aufrufen. Das Ergebnis fragt die gelieferte Funktion ab - der Flug ist nach
 * gut einer halben Sekunde vorbei, zu kurz fuers Nachsehen danach.
 */
async function watchTokenFlight() {
  await page.evaluate(() => {
    // Was das erste Briefchen als Zahl traegt: "1" ohne Zahl, null solange keins flog.
    const seen = () => {
      const token = document.querySelector('.lv-env-fly')
      return token ? (token.querySelector('.lv-env-cnt')?.textContent ?? '1') : null
    }
    window.__tokenFlew = seen()
    const watch = new MutationObserver(() => {
      window.__tokenFlew = seen()
      if (window.__tokenFlew) watch.disconnect()
    })
    watch.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => watch.disconnect(), 5000)
  })
  return () => until(() => page.evaluate(() => window.__tokenFlew), 'kein Briefchen', 3000).catch(() => false)
}
/** Leiste, Knoepfe und Menues des Lesebereichs, ueber Rolle und Namen. */
const toolbar = () => page.getByRole('toolbar', { name: 'Aktionen' })
const barButton = (name) => toolbar().getByRole('button', { name, exact: true })
const threadRows = () => page.getByRole('navigation', { name: 'Unterhaltung' }).getByRole('button')
const mailFrame = () => page.frameLocator('iframe[title="Nachrichteninhalt"]')
const focusedLabel = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent)

async function search(text) {
  await searchBox().fill(text)
  // Die Eingabe wird entprellt und die Liste danach neu geholt.
  await sleep(700)
}

const composeOpen = () => page.locator('.compose-dialog:visible')
const sendButton = () => composeOpen().getByRole('button', { name: 'Senden', exact: true })
/** Eine fertige Adresse steht als Marke im Feld, mit einem Knopf zum Entfernen. */
const recipientChip = (address) => composeOpen().getByRole('button', { name: `${address} entfernen` })
const windowBar = () => page.getByRole('navigation', { name: 'Offene Fenster' })

async function openComposer() {
  await railButton('Neue Nachricht').click()
  await page.waitForSelector('.compose-dialog:visible')
}

async function fillComposer({ to, subject, body }) {
  await page.fill('#compose-to', to)
  await page.fill('#compose-subject', subject)
  await page.click('.compose-editor:visible')
  await page.keyboard.press('Control+Home')
  await page.keyboard.type(body)
}

async function start(userData) {
  app = await electron.launch({
    executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [
      '.',
      `--user-data-dir=${userData}`,
      '--hidden',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      // Eine Maus, egal was der Rechner gerade meldet (Fernsitzung, Tablet-Modus):
      // sonst trifft @media (hover: hover) nicht zu, und kein Hover-Zustand greift.
      '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'
    ],
    cwd: root,
    env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }
  })
  page = await app.firstWindow()
  page.on('pageerror', (err) => console.log('  [seitenfehler]', err.message))
  await page.waitForLoadState('domcontentloaded')
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
}

async function main() {
  console.log('Bestand anlegen ...')
  await seed()

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mailclient-e2e-'))
  console.log(`App starten (Daten: ${userData}) ...`)
  await start(userData)

  // Einstellungen vor dem Konto, damit schon der erste Abgleich das kleine Fenster nimmt.
  await page.evaluate(() =>
    window.api.settings.update({ initialFetchCount: 200, notifyOnNewMail: false, undoSendSec: 3, runInTray: false })
  )
  await page.evaluate(
    ([email, host, imapPort]) =>
      window.api.accounts.save({
        label: 'Test',
        displayName: 'Tim Test',
        email,
        color: '#2f5bd0',
        imap: { host, port: imapPort, secure: true },
        smtp: { host, port: 3465, secure: true },
        username: email,
        signature: 'Tim',
        enabled: true,
        password: 'geheim'
      }),
    [TIM, HOST, IMAP_PROXY_PORT]
  )
  await page.reload()
  await page.waitForSelector('.lv-r', { timeout: 60000 })
  await until(async () => (await rowTexts()).some((t) => t.includes('Bitte um Rueckruf')), 'Posteingang wurde nicht geladen', 60000)
  // Der erste Abgleich laeuft noch durch die uebrigen Ordner.
  await until(
    () => page.evaluate(() => window.api.accounts.statuses().then((s) => s.every((x) => x.phase === 'idle'))),
    'Konto kommt nicht zur Ruhe',
    90000
  )
  await shot('01-start')

  console.log('Gmail-Sichten und Doppelte')
  await check('Sichten: "All Mail", "Important", "Starred" stehen nicht in der Ordnerliste', async () => {
    // Mit dem Konto vorn steht sein ganzer Baum da, auch die eigenen Ordner.
    await railButton(`Test · ${TIM}`).click()
    const labels = await folderColumn().locator('.lv-fi-lb').allTextContents()
    expect(labels.includes('Arbeit'), `Label-Ordner "Arbeit" fehlt: ${labels}`)
    for (const hidden of ['All Mail', 'Important', 'Starred']) {
      expect(!labels.includes(hidden), `"${hidden}" steht in der Ordnerliste`)
    }
  })

  await check('Sichten: werden nicht abgeglichen', async () => {
    const found = await page.evaluate(() =>
      window.api.messages.list({ kind: 'search', query: { text: 'betreff:"nur in alle"' } }).then((l) => l.length)
    )
    expect(found === 0, `Mail, die nur in "All Mail" liegt, ist lokal vorhanden (${found})`)
  })

  await check('Doppelte: dieselbe Mail steht in Sammelansicht und Suche nur einmal', async () => {
    await folderItem('Ungelesen').click()
    await until(async () => (await rowTexts()).length > 0, 'Ungelesen bleibt leer')
    const unread = (await rowTexts()).filter((t) => t === 'Teammeeting').length
    expect(unread === 1, `"Teammeeting" steht ${unread}-mal unter Ungelesen`)
    await folderItem('Posteingang').click()
    await search('teammeeting')
    const hits = (await rowTexts()).filter((t) => t === 'Teammeeting').length
    expect(hits === 1, `Suche zeigt "Teammeeting" ${hits}-mal`)
    await search('')
    await railButton(`Test · ${TIM}`).click()
    await folderItem('Arbeit').click()
    await until(async () => (await rowTexts()).includes('Teammeeting'), 'im Label-Ordner fehlt die Mail')
    await railButton('Alle Konten').click()
  })

  await check('Gelesen: sofort beim Oeffnen, auch waehrend ein Abgleich laeuft', async () => {
    const settings = await page.evaluate(() => window.api.settings.get())
    expect(settings.markReadAfterMs === 0, `Standard ist nicht "sofort", sondern ${settings.markReadAfterMs} ms`)
    await folderItem('Posteingang').click()
    const row = rowBySubject('Teammeeting')
    expect((await row.getAttribute('data-unread')) === 'true', 'Ausgangslage: Mail ist nicht ungelesen')
    // Einen vollen Abgleich anstossen - "gelesen" darf nicht dahinter warten.
    void page.evaluate(() => window.api.sync.refresh()).catch(() => {})
    await sleep(100)
    // Gemessen im Fenster selbst: vom Klick, bis die Zeile nicht mehr als ungelesen
    // gilt. Playwrights Klick wartet erst, bis die Liste stillhaelt - das zaehlt nicht.
    const measure = page.evaluate(
      () =>
        new Promise((resolve) => {
          let clickedAt = 0
          const target = () =>
            [...document.querySelectorAll('.lv-r')].find(
              (r) => r.querySelector('.lv-r-subj')?.textContent === 'Teammeeting'
            )
          document.addEventListener('click', () => (clickedAt ||= performance.now()), { capture: true, once: true })
          const timer = setInterval(() => {
            if (clickedAt && target()?.dataset.unread === 'false') {
              clearInterval(timer)
              resolve(performance.now() - clickedAt)
            }
          }, 10)
          setTimeout(() => {
            clearInterval(timer)
            resolve(-1)
          }, 10000)
        })
    )
    await row.click()
    const took = await measure
    expect(took >= 0, 'Zeile wird nicht als gelesen angezeigt')
    console.log(`         (gelesen ${Math.round(took)} ms nach dem Klick)`)
    expect(took < 300, `"gelesen" kam erst ${Math.round(took)} ms nach dem Klick`)
    await until(
      () => page.evaluate(() => window.api.accounts.statuses().then((s) => s.every((x) => x.phase === 'idle'))),
      'Abgleich wird nicht fertig',
      90000
    )
    expect((await row.getAttribute('data-unread')) === 'false', 'nach dem Abgleich ist die Mail wieder ungelesen')
    await until(async () => (await subjects(TIM)).find((m) => m.subject === 'Teammeeting')?.seen, 'Server kennt die Mail nicht als gelesen')
  })

  await check('Laden: eine nie geoeffnete Mail kommt sofort, auch waehrend ein Abruf laeuft', async () => {
    // Ein Server mit 80 ms Antwortzeit, wie viele im Internet: ein voller Abruf dauert dann Sekunden.
    imapProxy.latency = 80
    void page.evaluate(() => window.api.sync.refresh()).catch(() => {})
    await until(
      () => page.evaluate(() => window.api.accounts.statuses().then((s) => s.some((x) => x.phase === 'syncing'))),
      'Abruf startet nicht',
      5000
    )
    // Eine alte Fuellmail: die liegt hinter den 25 vorgeladenen, ihr Text ist nirgends zwischengespeichert.
    await search('betreff:"fuellmail 150"')
    await rowBySubject('Fuellmail 150').click()
    const clicked = Date.now()
    await until(
      async () => (await page.locator('.rv-plain').textContent().catch(() => '')).includes('Text von Fuellmail 150'),
      'Text erscheint nicht',
      30000
    )
    const took = Date.now() - clicked
    const stillSyncing = await page.evaluate(() =>
      window.api.accounts.statuses().then((s) => s.some((x) => x.phase === 'syncing'))
    )
    console.log(`         (Text nach ${took} ms, Abruf lief da noch: ${stillSyncing})`)
    imapProxy.latency = 0
    expect(stillSyncing, 'der Abruf war schon fertig - der Test misst so nichts')
    // Eine neue Verbindung braucht ein paar Rundlaeufe; mehr als das darf es nicht sein.
    expect(took < 1600, `Text kam erst nach ${took} ms`)
    await search('')
    await until(
      () => page.evaluate(() => window.api.accounts.statuses().then((s) => s.every((x) => x.phase === 'idle'))),
      'Abruf wird nicht fertig',
      120000
    )
  })

  console.log('Unterhaltungen')
  await check('Thread: eine Zeile je Unterhaltung mit Zaehler', async () => {
    const rows = rowBySubject('Projektplan')
    expect((await rows.count()) === 1, `erwartet 1 Zeile "Projektplan", gefunden ${await rows.count()}`)
    expect((await threadCount(rows).textContent()) === '3', 'Zaehler ist nicht 3')
    expect((await rows.getAttribute('data-unread')) === 'true', 'Zeile mit ungelesener Mail ist nicht als ungelesen markiert')
  })

  await check('Thread: Verlauf im Lesebereich samt eigener Antwort', async () => {
    await rowBySubject('Projektplan').click()
    await until(async () => (await threadRows().count()) === 3, 'Verlauf hat nicht 3 Eintraege')
    const where = await threadRows().locator('.rv-tag').allTextContents()
    expect(JSON.stringify(where) === '["Gesendet"]', `nur die Antwort aus Gesendet traegt ein Ordneretikett, gefunden: ${where}`)
    expect((await threadRows().nth(2).getAttribute('aria-current')) === 'true', 'die geoeffnete Mail ist im Verlauf nicht markiert')
    await threadRows().filter({ hasText: 'Gesendet' }).click()
    const frame = mailFrame()
    await until(async () => {
      const plain = await page.locator('.rv-plain').textContent().catch(() => '')
      const html = await frame.locator('body').textContent({ timeout: 500 }).catch(() => '')
      return `${plain}${html}`.includes('Antwort von Tim')
    }, 'Text der eigenen Antwort erscheint nicht')
    await shot('02-thread')
  })

  await check('Thread: oeffnen markiert die ganze Unterhaltung als gelesen', async () => {
    await until(async () => (await rowBySubject('Projektplan').getAttribute('data-unread')) === 'false', 'Zeile bleibt ungelesen')
    const server = await subjects(TIM)
    expect(server.filter((m) => m.subject === 'Re: Projektplan').every((m) => m.seen), 'Server kennt die Mail noch als ungelesen')
  })

  await check('Thread: fehlender Anfang wird vom Server nachgeladen', async () => {
    const before = await page.evaluate(() =>
      window.api.messages.list({ kind: 'search', query: { text: 'betreff:"altes thema"' } }).then((l) => l.length)
    )
    expect(before === 1, `der alte Anfang sollte lokal fehlen, gefunden: ${before} Mails`)
    await rowBySubject('Re: Altes Thema').click()
    await until(async () => (await threadRows().count()) === 2, 'Verlauf wurde nicht um die Mail vom Server ergaenzt', 20000)
    expect((await threadCount(rowBySubject('Re: Altes Thema')).textContent()) === '2', 'Zaehler zeigt nicht 2')
  })

  await check('Thread: abschaltbar', async () => {
    await page.evaluate(() => window.api.settings.update({ threadView: false }))
    await until(async () => (await rowBySubject('Projektplan').count()) === 2, 'ohne Zusammenfassen sollten 2 Zeilen stehen')
    expect((await messageList().getByTitle(/^Unterhaltung mit/).count()) === 0, 'Zaehler trotz abgeschalteter Ansicht')
    await page.evaluate(() => window.api.settings.update({ threadView: true }))
    await until(async () => (await rowBySubject('Projektplan').count()) === 1, 'Zusammenfassen kommt nicht zurueck')
  })

  console.log('Senden')
  await check('Undo Send: zurueckholen verhindert den Versand', async () => {
    await openComposer()
    await fillComposer({ to: ANNA, subject: 'Undo-Test', body: 'Das soll nie ankommen.' })
    await sendButton().click()
    await toast().locator('.toast-action', { hasText: 'Rückgängig' }).click()
    await page.waitForSelector('.compose-dialog')
    expect((await page.inputValue('#compose-subject')) === 'Undo-Test', 'Betreff ging beim Zurueckholen verloren')
    expect((await recipientChip(ANNA).count()) === 1, 'Empfaenger ging verloren')
    expect((await page.locator('.compose-editor').innerText()).includes('Das soll nie ankommen.'), 'Text ging verloren')
    await page.keyboard.press('Escape')
    await sleep(4500)
    const got = await subjects(ANNA)
    expect(!got.some((m) => m.subject === 'Undo-Test'), 'Nachricht kam trotz Zurueckholen an')
    expect((await page.evaluate(() => window.api.outbox.list())).length === 0, 'Ausgang ist nicht leer')
  })

  await check('Undo Send: ohne Eingreifen geht die Mail nach der Frist raus', async () => {
    await openComposer()
    await fillComposer({ to: ANNA, subject: 'Frist-Test', body: 'Das soll ankommen.' })
    await sendButton().click()
    await toast().waitFor()
    expect(!(await subjects(ANNA)).some((m) => m.subject === 'Frist-Test'), 'Nachricht ging vor Ablauf der Frist raus')
    await until(async () => (await subjects(ANNA)).some((m) => m.subject === 'Frist-Test'), 'Nachricht kam nie an')
    await until(async () => (await subjects(TIM, 'Sent')).some((m) => m.subject === 'Frist-Test'), 'Kopie fehlt in Gesendet')
  })

  await check('Undo Send: Frist 0 sendet sofort', async () => {
    await page.evaluate(() => window.api.settings.update({ undoSendSec: 0 }))
    await openComposer()
    await fillComposer({ to: ANNA, subject: 'Sofort-Test', body: 'Ohne Frist.' })
    await sendButton().click()
    await until(async () => (await toast().textContent().catch(() => '')).includes('Gesendet'), 'Meldung "Gesendet" fehlt')
    expect((await subjects(ANNA)).some((m) => m.subject === 'Sofort-Test'), 'Nachricht kam nicht an')
    await page.evaluate(() => window.api.settings.update({ undoSendSec: 3 }))
  })

  await check('Send Later: geplante Nachricht wartet im Ausgang, "Jetzt senden" schickt sie', async () => {
    await openComposer()
    await fillComposer({ to: ANNA, subject: 'Geplant-Test', body: 'Spaeter.' })
    await composeOpen().getByRole('button', { name: 'Später senden' }).click()
    await composeOpen().getByRole('menuitem', { name: /^In einer Stunde/ }).click()
    await until(async () => (await toast().textContent().catch(() => '')).includes('Geplant'), 'Meldung "Geplant" fehlt')
    const outbox = await page.evaluate(() => window.api.outbox.list())
    expect(outbox.length === 1 && outbox[0].kind === 'scheduled', `Ausgang: ${JSON.stringify(outbox)}`)
    expect(outbox[0].sendAt - Date.now() > 50 * 60_000, 'Termin liegt nicht rund eine Stunde voraus')
    await sleep(4000)
    expect(!(await subjects(ANNA)).some((m) => m.subject === 'Geplant-Test'), 'geplante Nachricht ging sofort raus')

    await openSettings('Ausgang')
    expect((await page.locator('.account-row', { hasText: 'Geplant-Test' }).textContent()).includes('Geplant fuer'), 'Ausgang zeigt den Termin nicht')
    await shot('03-ausgang')
    await page.locator('.account-row', { hasText: 'Geplant-Test' }).locator('button', { hasText: 'Jetzt senden' }).click()
    await until(async () => (await subjects(ANNA)).some((m) => m.subject === 'Geplant-Test'), 'Nachricht kam nach "Jetzt senden" nicht an')
  })

  await check('Send Later: Termin wird eingehalten', async () => {
    const sendAt = Date.now() + 6000
    await page.evaluate(
      ([to, at]) =>
        window.api.accounts.list().then((accounts) =>
          window.api.mail.send(
            { accountId: accounts[0].id, to: [{ address: to }], cc: [], bcc: [], subject: 'Termin-Test', html: '<p>x</p>', text: 'x', attachments: [] },
            { sendAt: at }
          )
        ),
      [ANNA, sendAt]
    )
    await sleep(3000)
    expect(!(await subjects(ANNA)).some((m) => m.subject === 'Termin-Test'), 'ging vor dem Termin raus')
    await until(async () => (await subjects(ANNA)).some((m) => m.subject === 'Termin-Test'), 'kam zum Termin nicht an')
    expect(Date.now() >= sendAt, 'kam vor dem Termin an')
  })

  await check('Send Later: geplante Nachricht laesst sich bearbeiten', async () => {
    await page.evaluate(
      ([to]) =>
        window.api.accounts.list().then((accounts) =>
          window.api.mail.send(
            { accountId: accounts[0].id, to: [{ address: to }], cc: [], bcc: [{ address: 'blind@test.local' }], subject: 'Bearbeiten-Test', html: '<p>Inhalt bleibt</p>', text: 'Inhalt bleibt', attachments: [{ filename: 'a.txt', content: 'aGFsbG8=', contentType: 'text/plain' }] },
            { sendAt: Date.now() + 3_600_000 }
          )
        ),
      [ANNA]
    )
    await openSettings('Ausgang')
    await page.locator('.account-row', { hasText: 'Bearbeiten-Test' }).locator('button', { hasText: 'Bearbeiten' }).click()
    await page.waitForSelector('.compose-dialog')
    expect((await page.locator('.compose-editor').innerText()).includes('Inhalt bleibt'), 'Text fehlt')
    expect((await recipientChip('blind@test.local').count()) === 1, 'Blindkopie fehlt')
    expect((await composeOpen().getByRole('button', { name: 'a.txt entfernen' }).count()) === 1, 'Anhang fehlt')
    expect((await page.evaluate(() => window.api.outbox.list())).length === 0, 'Eintrag liegt weiter im Ausgang')
    await page.keyboard.press('Escape')
  })

  console.log('Entwuerfe')
  const draftsOf = () => folderMails(TIM, 'Drafts')

  await check('Entwurf: Speichern legt eine Fassung ab und ersetzt sie beim naechsten Mal', async () => {
    await clearFolder(TIM, 'Drafts')
    const trashBefore = (await subjects(TIM, 'Trash')).length
    await openComposer()
    await fillComposer({ to: ANNA, subject: 'Entwurf-Test', body: 'Erste Fassung' })
    await composeOpen().getByRole('button', { name: 'Kopie, Blindkopie' }).click()
    await page.fill('#compose-bcc', 'blind@test.local')
    await composeOpen().getByRole('button', { name: 'Als Entwurf speichern' }).click()
    await until(async () => {
      const d = await draftsOf()
      return d.length === 1 && d[0].draft && d[0].source.includes('Erste Fassung')
    }, 'erste Fassung liegt nicht in Entwuerfe')
    expect((await draftsOf())[0].source.includes('blind@test.local'), 'Blindkopie fehlt im Entwurf')
    await page.getByRole('status').filter({ hasText: 'Entwurf gespeichert' }).waitFor()

    await page.click('.compose-editor:visible')
    await page.keyboard.press('Control+End')
    await page.keyboard.type(' und zweite')
    await composeOpen().getByRole('button', { name: 'Als Entwurf speichern' }).click()
    await until(async () => {
      const d = await draftsOf()
      return d.length === 1 && d[0].source.includes('und zweite')
    }, 'zweite Fassung hat die erste nicht ersetzt')
    expect((await subjects(TIM, 'Trash')).length === trashBefore, 'alte Fassung landete im Papierkorb')

    await page.keyboard.press('Escape')
    await until(async () => (await composeOpen().count()) === 0, 'Esc schliesst das Fenster nicht')
    await sleep(800)
    expect((await draftsOf()).length === 1, 'Esc ohne Aenderung hat noch eine Fassung angelegt')
  })

  await check('Entwurf: Klick daneben legt das Fenster in die Leiste und sichert es', async () => {
    await clearFolder(TIM, 'Drafts')
    await openComposer()
    await fillComposer({ to: ANNA, subject: 'Leiste-Test', body: 'Bleibt da' })
    await page.mouse.click(8, 450)
    await until(async () => (await composeOpen().count()) === 0, 'Fenster ist noch offen')
    const tab = windowBar().getByRole('button', { name: 'Leiste-Test', exact: true })
    await tab.waitFor()
    await until(async () => (await draftsOf()).some((d) => d.subject === 'Leiste-Test'), 'Minimieren hat nicht gespeichert')
    // Waehrend es in der Leiste liegt, gehen die Tastenkuerzel der Liste.
    expect((await page.locator('#compose-to').count()) === 0, 'feste id haengt am versteckten Fenster')

    await tab.click()
    await composeOpen().waitFor()
    expect((await page.locator('.compose-editor:visible').innerText()).includes('Bleibt da'), 'Text ging in der Leiste verloren')
    await page.keyboard.press('Escape')
    await until(async () => (await windowBar().count()) === 0, 'Leiste bleibt nach dem Schliessen stehen')
    expect((await draftsOf()).length === 1, 'Schliessen ohne Aenderung legte eine zweite Fassung an')
  })

  await check('Entwurf: zwei Fenster gleichzeitig, das x am Reiter schliesst und sichert', async () => {
    await clearFolder(TIM, 'Drafts')
    await openComposer()
    await fillComposer({ to: ANNA, subject: 'Erstes Fenster', body: 'eins' })
    await page.mouse.click(8, 450)
    await openComposer()
    await fillComposer({ to: ANNA, subject: 'Zweites Fenster', body: 'zwei' })
    await page.mouse.click(8, 450)
    await until(async () => (await windowBar().getByRole('button', { name: /Fenster$/ }).count()) === 2, 'zwei Reiter fehlen')
    await windowBar().getByRole('group', { name: 'Erstes Fenster' }).getByRole('button', { name: 'Schließen, Entwurf bleibt' }).click()
    await until(async () => (await windowBar().getByRole('button', { name: /Fenster$/ }).count()) === 1, 'Reiter bleibt nach x')
    await until(async () => (await draftsOf()).length === 2, 'nicht beide Entwuerfe gespeichert')
    await windowBar().getByRole('group', { name: 'Zweites Fenster' }).getByRole('button', { name: 'Schließen, Entwurf bleibt' }).click()
    await until(async () => (await windowBar().count()) === 0, 'Leiste bleibt stehen')
  })

  await check('Entwurf: eine unveraenderte Antwort hinterlaesst keinen', async () => {
    await clearFolder(TIM, 'Drafts')
    await rowBySubject('Bitte um Rueckruf').first().click()
    await barButton('Antworten').click()
    await composeOpen().waitFor()
    await page.keyboard.press('Escape')
    await until(async () => (await composeOpen().count()) === 0, 'Esc schliesst die Antwort nicht')
    await sleep(1000)
    expect((await draftsOf()).length === 0, 'unveraenderte Antwort wurde gespeichert')
  })

  await check('Entwurf: aus Entwürfe weiterschreiben und senden raeumt ihn weg', async () => {
    await clearFolder(TIM, 'Drafts')
    await page.evaluate(
      ([to]) =>
        window.api.accounts.list().then((accounts) =>
          window.api.drafts.save({ accountId: accounts[0].id, to: [{ address: to }], cc: [], bcc: [], subject: 'Weiter-Test', html: '<p>Angefangen</p>', text: 'Angefangen', attachments: [] })
        ),
      [ANNA]
    )
    await railButton(`Test · ${TIM}`).click()
    await folderItem('Entwürfe').click()
    await until(async () => (await rowBySubject('Weiter-Test').count()) === 1, 'Entwurf erscheint nicht in Entwürfe')
    const draftRow = rowBySubject('Weiter-Test')
    expect((await draftRow.locator('.lv-r-nm').textContent()) === `An${ANNA}`, `Zeile zeigt nicht "An" und den Empfänger: ${await draftRow.locator('.lv-r-nm').textContent()}`)
    expect((await draftRow.getByRole('button', { name: /als (un)?gelesen markieren/i }).count()) === 0, 'Entwurf hat einen Punkt für ungelesen')
    await draftRow.click()
    await page.getByText(/^Entwurf, noch nicht gesendet · gespeichert heute, \d\d:\d\d$/).waitFor()
    expect((await barButton('Archivieren').count()) === 0 && (await barButton('In den Papierkorb').count()) === 1, 'Leiste eines Entwurfs hat mehr als den Papierkorb')
    await barButton('Weiterschreiben').click()
    await composeOpen().waitFor()
    expect((await page.inputValue('#compose-subject')) === 'Weiter-Test', 'Betreff fehlt')
    expect((await page.locator('.compose-editor:visible').innerText()).includes('Angefangen'), 'Text fehlt')
    await page.click('.compose-editor:visible')
    await page.keyboard.press('Control+End')
    await page.keyboard.type(' und fertig')
    await page.evaluate(() => window.api.settings.update({ undoSendSec: 0 }))
    await sendButton().click()
    await until(async () => (await subjects(ANNA)).some((m) => m.subject === 'Weiter-Test'), 'Mail kam nicht an')
    await until(async () => (await draftsOf()).length === 0, 'Entwurf blieb nach dem Senden liegen')
    await page.evaluate(() => window.api.settings.update({ undoSendSec: 3 }))
  })

  await check('Entwurf: derselbe Entwurf zweimal geoeffnet bleibt ein Fenster', async () => {
    await clearFolder(TIM, 'Drafts')
    await openComposer()
    await fillComposer({ to: ANNA, subject: 'Einmal-Test', body: 'nur ein Fenster' })
    await composeOpen().getByRole('button', { name: 'Als Entwurf speichern' }).click()
    await until(async () => (await draftsOf()).length === 1, 'nicht gespeichert')
    await page.click('.compose-editor:visible')
    await page.keyboard.type(' mehr')
    await page.mouse.click(8, 450)
    await until(async () => (await draftsOf()).some((d) => d.source.includes('mehr')), 'Minimieren hat nicht gespeichert')
    await railButton(`Test · ${TIM}`).click()
    await folderItem('Entwürfe').click()
    await page.evaluate(() => window.api.accounts.list().then((a) => window.api.sync.refresh(a[0].id, 'Drafts')))
    await until(async () => (await rowBySubject('Einmal-Test').count()) === 1, 'Entwurf fehlt in der Liste')
    await rowBySubject('Einmal-Test').dblclick()
    await composeOpen().waitFor()
    expect((await windowBar().getByRole('group').count()) === 1, 'derselbe Entwurf ging ein zweites Mal auf')
    await page.keyboard.press('Escape')
    await until(async () => (await windowBar().count()) === 0, 'Leiste bleibt stehen')
    expect((await draftsOf()).length === 1, 'zwei Entwuerfe auf dem Server')
  })

  await check('Entwurf: Verwerfen legt ihn in den Papierkorb', async () => {
    await clearFolder(TIM, 'Drafts')
    await openComposer()
    await fillComposer({ to: ANNA, subject: 'Verwerfen-Test', body: 'weg damit' })
    await composeOpen().getByRole('button', { name: 'Als Entwurf speichern' }).click()
    await until(async () => (await draftsOf()).length === 1, 'nicht gespeichert')
    await composeOpen().getByRole('button', { name: 'Verwerfen' }).click()
    await until(async () => (await composeOpen().count()) === 0, 'Verwerfen schliesst nicht')
    await until(async () => (await draftsOf()).length === 0, 'Entwurf blieb in Entwuerfe')
    await until(async () => (await subjects(TIM, 'Trash')).some((m) => m.subject === 'Verwerfen-Test'), 'Entwurf fehlt im Papierkorb')
  })

  await check('Entwurf: scheitert das Speichern, bleibt das Fenster mit dem Grund offen, ein zweiter Klick auf X schliesst', async () => {
    await clearFolder(TIM, 'Drafts')
    await openComposer()
    await fillComposer({ to: ANNA, subject: 'Offline-Test', body: 'Bleibt im Fenster' })
    cutImap()
    try {
      await composeOpen().getByRole('button', { name: 'Schließen', exact: true }).click()
      const alert = composeOpen().getByRole('alert')
      await alert.waitFor({ timeout: 30000 })
      const text = await alert.textContent()
      expect(text.startsWith('Der Entwurf ließ sich nicht speichern.'), `Meldung: ${text}`)
      expect(text.includes('Test ist offline.'), `Grund fehlt oder stimmt nicht: ${text}`)
      expect(text.includes('Dein Text bleibt in diesem Fenster.'), `Hinweis fehlt: ${text}`)
      expect(!/[A-Z]{4,}|Error|invoking/.test(text), `roher Fehlercode in der Meldung: ${text}`)
      expect((await composeOpen().count()) === 1, 'Fenster ging trotz Fehler zu')
      await composeOpen().getByRole('status').filter({ hasText: 'Nicht gespeichert' }).waitFor()
      await composeOpen().getByRole('tooltip').filter({ hasText: 'Noch einmal klicken schließt ohne Speichern' }).waitFor()
      await composeOpen().getByRole('button', { name: 'Ohne Speichern schließen' }).click()
      await until(async () => (await composeOpen().count()) === 0, 'zweiter Klick schliesst nicht')
      await until(async () => (await windowBar().count()) === 0, 'Reiter bleibt nach dem Schliessen')
    } finally {
      imapProxy.down = false
    }
    await until(
      () => page.evaluate(() => window.api.accounts.statuses().then((s) => s.every((x) => x.phase === 'idle'))),
      'Konto kommt nach der Unterbrechung nicht zur Ruhe',
      90000
    )
    expect((await draftsOf()).length === 0, 'ohne Speichern geschlossen, trotzdem liegt ein Entwurf da')
  })

  await check('Fenster: Bilder zum Vergleich mit dem Entwurf', async () => {
    await windowShots()
  })

  await check('Mail-Fenster: Doppelklick oeffnet die Mail, Klick daneben legt sie in die Leiste, Antworten nimmt ihren Platz, Esc schliesst', async () => {
    const row = rowBySubject('Bitte um Rueckruf').first()
    await row.dblclick()
    const mailWindow = page.getByRole('dialog', { name: 'Bitte um Rueckruf' })
    await mailWindow.waitFor()
    await mailWindow.getByRole('heading', { name: 'Bitte um Rueckruf' }).waitFor()
    expect((await row.getAttribute('aria-selected')) === 'true', 'Doppelklick waehlt die Zeile nicht aus')

    await page.mouse.click(8, 450)
    await until(async () => (await mailWindow.count()) === 0, 'Klick daneben legt das Fenster nicht weg')
    const tabGroup = windowBar().getByRole('group', { name: 'Bitte um Rueckruf' })
    const tab = tabGroup.getByRole('button', { name: 'Bitte um Rueckruf', exact: true })
    expect((await tab.getAttribute('title')) === 'Mail: Bitte um Rueckruf', `Tooltip am Reiter: ${await tab.getAttribute('title')}`)
    expect((await tabGroup.getByRole('button', { name: 'Schließen', exact: true }).count()) === 1, 'x am Reiter heisst nicht "Schließen"')

    await tab.click()
    await mailWindow.waitFor()
    expect((await tab.getAttribute('aria-pressed')) === 'true', 'Reiter ist nicht als offen markiert')
    // Antworten zitiert diese Mail; das Verfassen-Fenster nimmt den Platz, die Mail geht in die Leiste.
    await mailWindow.getByRole('button', { name: 'Antworten', exact: true }).click()
    await composeOpen().waitFor()
    expect((await page.locator('.compose-editor:visible').innerText()).includes('Ruf mich bitte an.'), 'Antwort zitiert nicht die Mail aus dem Fenster')
    await until(async () => (await mailWindow.count()) === 0 && (await tab.getAttribute('aria-pressed')) === 'false', 'Mail-Fenster bleibt aufgeklappt')
    await page.keyboard.press('Escape')
    await until(async () => (await composeOpen().count()) === 0, 'Antwort schliesst nicht')

    await tab.click()
    await mailWindow.waitFor()
    await page.keyboard.press('Escape')
    await until(async () => (await windowBar().count()) === 0, 'Esc schliesst das Mail-Fenster nicht')
  })

  await check('Senden: Blindkopie steht nicht im Kopf der verschickten Mail', async () => {
    await page.evaluate(() => window.api.settings.update({ undoSendSec: 0 }))
    await page.evaluate(
      ([to]) =>
        window.api.accounts.list().then((accounts) =>
          window.api.mail.send({ accountId: accounts[0].id, to: [{ address: to }], cc: [], bcc: [{ address: 'geheim@test.local' }], subject: 'Bcc-Test', html: '<p>x</p>', text: 'x', attachments: [] })
        ),
      [ANNA]
    )
    await page.evaluate(() => window.api.settings.update({ undoSendSec: 3 }))
    const got = await until(async () => (await folderMails(ANNA, 'INBOX')).find((m) => m.subject === 'Bcc-Test'), 'Mail kam nicht an')
    expect(!/^Bcc:/im.test(got.source.split('\r\n\r\n')[0]), 'Bcc-Zeile ging an den Empfaenger mit')
    await until(async () => (await folderMails(TIM, 'Sent')).some((m) => m.subject === 'Bcc-Test' && m.source.includes('geheim@test.local')), 'Gesendet-Kopie ohne Blindkopie')
  })

  console.log('Zurueckstellen')
  await check('Snooze: Mail verschwindet und steht unter "Zurueckgestellt"', async () => {
    await rowBySubject('Newsletter Herbst').click()
    await barButton('Zurückstellen').click()
    await page.getByRole('menuitem', { name: /^In einer Stunde/ }).click()
    await until(async () => (await rowBySubject('Newsletter Herbst').count()) === 0, 'Mail steht weiter im Posteingang')
    expect((await subjects(TIM)).some((m) => m.subject === 'Newsletter Herbst'), 'Mail ist auf dem Server verschwunden - Zurueckstellen soll lokal bleiben')
    await folderItem('Zurückgestellt').click()
    await until(async () => (await rowBySubject('Newsletter Herbst').count()) === 1, 'Mail fehlt unter "Zurueckgestellt"')
    expect((await rowBySubject('Newsletter Herbst').getByText(/^bis /).count()) === 1, 'Zeitpunkt wird nicht gezeigt')
    await shot('04-zurueckgestellt')
  })

  await check('Snooze: "Jetzt zurueckholen" bringt die Mail zurueck', async () => {
    await folderItem('Zurückgestellt').click()
    await rowBySubject('Newsletter Herbst').click()
    expect((await page.getByRole('status').filter({ hasText: 'Zurückgestellt bis' }).count()) === 1, 'Hinweis "Zurückgestellt bis" fehlt')
    await page.getByRole('button', { name: 'Jetzt zurückholen' }).click()
    await until(async () => (await rowBySubject('Newsletter Herbst').count()) === 0, 'Mail steht weiter unter "Zurueckgestellt"')
    await folderItem('Posteingang').click()
    await until(async () => (await rowBySubject('Newsletter Herbst').count()) === 1, 'Mail fehlt im Posteingang')
  })

  await check('Snooze: taucht zum Zeitpunkt oben und ungelesen wieder auf', async () => {
    await page.evaluate(() =>
      window.api.messages.list({ kind: 'unified', id: 'inbox' }).then((list) => {
        const target = list.find((m) => m.subject === 'Rechnung 4711')
        return window.api.messages.snooze([target], Date.now() + 4000)
      })
    )
    await until(async () => (await rowBySubject('Rechnung 4711').count()) === 0, 'Mail wurde nicht ausgeblendet')
    await until(async () => (await rowBySubject('Rechnung 4711').count()) === 1, 'Mail kam nicht zurueck', 12000)
    const first = await messageList().locator('.lv-r-subj').first().textContent()
    expect(first === 'Rechnung 4711', `wieder aufgetauchte Mail steht nicht oben, sondern: ${first}`)
    expect((await rowBySubject('Rechnung 4711').getByText('Wieder da', { exact: true }).count()) === 1, 'Hinweis "Wieder da" fehlt')
    await until(async () => (await rowBySubject('Rechnung 4711').getAttribute('data-unread')) === 'true', 'Mail ist nicht ungelesen')
    await shot('05-wieder-da')
    // Lesen erledigt die Sache: der Hinweis verschwindet, die Mail sortiert sich wieder ein.
    await rowBySubject('Rechnung 4711').click()
    await until(async () => (await rowBySubject('Rechnung 4711').getByText(/^(bis |Wieder da)/).count()) === 0, 'Hinweis bleibt nach dem Lesen stehen')
  })

  await check('Snooze: ueberlebt einen Neustart der App', async () => {
    await page.evaluate(() =>
      window.api.messages.list({ kind: 'unified', id: 'inbox' }).then((list) => {
        const target = list.find((m) => m.subject === 'Mittagessen')
        return window.api.messages.snooze([target], Date.now() + 3_600_000)
      })
    )
    await until(async () => (await rowBySubject('Mittagessen').count()) === 0, 'Mail wurde nicht ausgeblendet')
    await app.close()
    await start(userData)
    await page.waitForSelector('.lv-r', { timeout: 60000 })
    await sleep(1500)
    expect((await rowBySubject('Mittagessen').count()) === 0, 'nach dem Neustart ist die Mail wieder sichtbar')
    await folderItem('Zurückgestellt').click()
    await until(async () => (await rowBySubject('Mittagessen').count()) === 1, 'Zurueckstellung ging beim Neustart verloren')
    await folderItem('Posteingang').click()
    await until(
      () => page.evaluate(() => window.api.accounts.statuses().then((s) => s.every((x) => x.phase === 'idle'))),
      'Konto kommt nach dem Neustart nicht zur Ruhe',
      90000
    )
  })

  console.log('Vorlagen')
  await check('Vorlagen: anlegen und im Verfassen-Dialog einsetzen', async () => {
    await openSettings('Vorlagen')
    await page.locator('button', { hasText: 'Vorlage anlegen' }).click()
    await page.fill('#tpl-name', 'Terminzusage')
    await page.fill('#tpl-subject', 'Termin bestaetigt')
    await page.fill('#tpl-body', 'Hallo,\n\nder Termin passt <gut>.\n\nGruss')
    await page.locator('button', { hasText: 'Speichern' }).click()
    await until(async () => (await page.locator('.account-row', { hasText: 'Terminzusage' }).count()) === 1, 'Vorlage steht nicht in der Liste')
    await page.locator('.dialog-foot .btn-primary', { hasText: 'Fertig' }).click()

    await openComposer()
    await composeOpen().getByRole('button', { name: 'Vorlage' }).click()
    await composeOpen().getByRole('menuitem', { name: 'Terminzusage' }).click()
    const text = await page.locator('.compose-editor').innerText()
    expect(text.includes('der Termin passt <gut>.'), `Vorlagentext fehlt oder wurde als HTML gelesen: ${JSON.stringify(text)}`)
    expect(text.indexOf('Hallo') < text.indexOf('--'), 'Vorlage steht nicht vor der Signatur')
    expect((await page.inputValue('#compose-subject')) === 'Termin bestaetigt', 'Betreff wurde nicht uebernommen')
    await shot('06-vorlage')
    await page.keyboard.press('Escape')
  })

  await check('Vorlagen: vorhandener Betreff bleibt stehen', async () => {
    await openComposer()
    await page.fill('#compose-subject', 'Mein Betreff')
    await composeOpen().getByRole('button', { name: 'Vorlage' }).click()
    await composeOpen().getByRole('menuitem', { name: 'Terminzusage' }).click()
    expect((await page.inputValue('#compose-subject')) === 'Mein Betreff', 'Betreff wurde ueberschrieben')
    await page.keyboard.press('Escape')
  })

  console.log('Anhaenge und Suche')
  await check('Anhaenge: Sammelansicht zeigt nur Mails mit Anhang samt Dateinamen', async () => {
    await folderItem('Anhänge').click()
    await until(async () => {
      const texts = await rowTexts()
      return texts.length === 1 && texts[0] === 'Rechnung 4711'
    }, 'erwartet nur "Rechnung 4711" in der Ansicht')
    expect((await messageList().locator('.lv-r-snip').first().textContent()).includes('rechnung-4711.pdf'), 'Dateiname fehlt in der Zeile')
    await shot('07-anhaenge')
    await folderItem('Posteingang').click()
  })

  const searches = [
    ['hat:anhang', ['Rechnung 4711']],
    ['datei:4711', ['Rechnung 4711']],
    ['von:buchhaltung', ['Rechnung 4711']],
    ['von:anna betreff:mittag', []], // zurueckgestellt, aber die Suche findet trotzdem -> siehe unten
    ['betreff:"bitte um"', ['Bitte um Rueckruf']],
    ['von:chef rueckruf', ['Bitte um Rueckruf']],
    ['vor:2020-01-01', ['Altes Thema']],
    ['nach:gestern von:news', ['Newsletter Herbst']],
    ['von:niemand', []]
  ]
  for (const [text, expected] of searches) {
    if (text === 'von:anna betreff:mittag') {
      await check(`Suche: ${text} findet auch Zurueckgestelltes`, async () => {
        await search(text)
        const texts = await rowTexts()
        expect(texts.length === 1 && texts[0] === 'Mittagessen', `gefunden: ${texts}`)
      })
      continue
    }
    await check(`Suche: ${text}`, async () => {
      await search(text)
      const texts = [...new Set(await rowTexts())].sort()
      expect(JSON.stringify(texts) === JSON.stringify([...expected].sort()), `erwartet ${JSON.stringify(expected)}, gefunden ${JSON.stringify(texts)}`)
    })
  }
  await check('Suche: gewoehnlicher Text ohne Kuerzel geht weiter', async () => {
    await search('herbst')
    expect((await rowTexts()).includes('Newsletter Herbst'), 'Freitextsuche findet nichts')
    await search('ist:ungelesen')
    const texts = await rowTexts()
    expect(texts.length > 0 && !texts.includes('Bitte um Rueckruf'), `ist:ungelesen liefert Gelesenes: ${texts}`)
    await search('')
  })

  console.log('Vergroessern')
  await check('Zoom: Bilder zur Durchsicht', async () => {
    for (const subject of ['Layout-Test', 'Zoom-Test', 'Fliesstext-Test']) {
      await rowBySubject(subject).click()
      await page.frameLocator('iframe[title="Nachrichteninhalt"]').locator('body').waitFor()
      await sleep(600)
      for (const [label, presses] of [['100', 0], ['150', 3], ['250', 3]]) {
        for (let i = 0; i < presses; i++) await page.keyboard.press('Control+Equal')
        await sleep(600)
        await shot(`zoom-${subject}-${label}`)
      }
      await page.keyboard.press('Control+0')
      await sleep(300)
    }
  })
  await check('Zoom: Strg+Mausrad vergroessert die Mail, nicht die Oberflaeche', async () => {
    await rowBySubject('Zoom-Test').click()
    await page.keyboard.press('Control+0')
    const frame = page.frameLocator('iframe[title="Nachrichteninhalt"]')
    await frame.locator('#zoom-img').waitFor()
    const measure = () =>
      page.evaluate(() => {
        const iframe = document.querySelector('iframe[title="Nachrichteninhalt"]')
        const doc = iframe.contentDocument
        const scroller = document.querySelector('.rv-scroll')
        return {
          subject: document.querySelector('.rv-subject').getBoundingClientRect().height,
          label: document.querySelector('.rv-k').getBoundingClientRect().height,
          bar: document.querySelector('.rv-bar').getBoundingClientRect().height,
          sheetRight: document.querySelector('.rv-sheet').getBoundingClientRect().right,
          frameRight: iframe.getBoundingClientRect().right,
          ui: document.querySelector('.lv-sf').getBoundingClientRect().height,
          ratio: window.devicePixelRatio,
          img: doc.getElementById('zoom-img').getBoundingClientRect().width,
          font: doc.getElementById('zoom-text').getBoundingClientRect().height,
          iframeW: iframe.getBoundingClientRect().width,
          overflow: scroller.scrollWidth - scroller.clientWidth,
          imgLeft: doc.getElementById('zoom-img').getBoundingClientRect().left + iframe.getBoundingClientRect().left
        }
      })
    const before = await measure()
    const box = await page.locator('iframe[title="Nachrichteninhalt"]').boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + 60)

    await page.keyboard.down('Control')
    for (let i = 0; i < 6; i++) {
      // Der Zeiger steht still - so dreht man am Rad, und so blieb es frueher haengen.
      await page.mouse.wheel(0, -100)
      await sleep(60)
    }
    await page.keyboard.up('Control')
    await sleep(500)
    const after = await measure()

    await sleep(800)
    await shot('09-zoom')
    expect(after.ratio === before.ratio && after.ui === before.ui, 'die Oberflaeche wurde mitvergroessert')
    expect(after.img >= before.img * 1.9, `Bild wuchs nur von ${before.img} auf ${after.img}`)
    expect(after.font >= before.font * 1.5, `Text wuchs nur von ${before.font} auf ${after.font}`)
    expect(after.overflow > 0, 'der Lesebereich laesst sich nicht seitlich scrollen')
    expect(after.subject >= before.subject * 2, `der Kopf der Mail wuchs nicht mit (${before.subject} -> ${after.subject})`)
    // Kopf und Mail im selben Massstab, die Leiste bleibt.
    const headScale = after.label / before.label
    const bodyScale = after.font / before.font
    expect(Math.abs(headScale - bodyScale) < 0.15, `Kopf (${headScale.toFixed(2)}x) und Mail (${bodyScale.toFixed(2)}x) wachsen verschieden`)
    expect(after.bar === before.bar, 'die Leiste wurde mitvergroessert')
    expect(after.frameRight <= after.sheetRight + 1, `der Inhalt ragt ueber das Blatt hinaus (${after.frameRight} > ${after.sheetRight})`)
    // Zurueckstellen, damit die Groesse nicht in andere Tests wirkt.
    await page.keyboard.press('Control+0')
    await sleep(300)
    const reset = await measure()
    expect(Math.abs(reset.img - before.img) < 1 && reset.overflow <= 0, `Strg+0 stellt nicht zurueck: ${JSON.stringify(reset)}`)
  })

  await check('Breite: das Blatt fuellt den Lesebereich, auch bei breitem Fenster', async () => {
    await rowBySubject('Fliesstext-Test').click()
    await page.keyboard.press('Control+0')
    await page.frameLocator('iframe[title="Nachrichteninhalt"]').locator('#flow').waitFor()
    for (const width of [1440, 2200]) {
      await page.setViewportSize({ width, height: 900 })
      await sleep(500)
      const m = await page.evaluate(() => ({
        pane: document.querySelector('.rv-scroll').clientWidth,
        sheet: document.querySelector('.rv-sheet').getBoundingClientRect().width,
        frame: document.querySelector('iframe[title="Nachrichteninhalt"]').getBoundingClientRect().width
      }))
      expect(m.pane - m.sheet <= 34, `bei ${width} px: Blatt ${m.sheet} px in ${m.pane} px Lesebereich`)
      expect(m.sheet - m.frame <= 2, `bei ${width} px: Inhalt ${m.frame} px in ${m.sheet} px Blatt`)
      await shot(`breite-${width}`)
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await sleep(400)
  })

  await check('Zoom: Fliesstext bricht um statt seitlich wegzulaufen', async () => {
    await rowBySubject('Fliesstext-Test').click()
    await page.keyboard.press('Control+0')
    const frame = page.frameLocator('iframe[title="Nachrichteninhalt"]')
    await frame.locator('#flow').waitFor()
    const lineHeight = () =>
      page.evaluate(() => {
        const doc = document.querySelector('iframe[title="Nachrichteninhalt"]').contentDocument
        const scroller = document.querySelector('.rv-scroll')
        return {
          font: parseFloat(getComputedStyle(doc.getElementById('flow')).fontSize) * Number(doc.body.style.zoom || 1),
          overflow: scroller.scrollWidth - scroller.clientWidth
        }
      })
    const before = await lineHeight()
    for (let i = 0; i < 6; i++) await page.keyboard.press('Control+Equal')
    await sleep(600)
    const after = await lineHeight()
    expect(after.font >= before.font * 2, `Text wuchs nur von ${before.font} auf ${after.font}`)
    expect(after.overflow <= 0, `Fliesstext laeuft seitlich ueber (${after.overflow}px)`)
    await page.keyboard.press('Control+0')
    await sleep(300)
  })

  console.log('Haptik')
  await check('Haptik: Icons bewegen sich beim Hover, Knoepfe geben beim Druecken nach', async () => {
    await rowBySubject('Fliesstext-Test').click()
    const transformOf = (locator) => locator.evaluate((el) => getComputedStyle(el).transform)
    const cases = [
      [barButton('Antworten'), 'reply'],
      [barButton('Weiterleiten'), 'forward'],
      [barButton('Markieren'), 'star'],
      [barButton('Als ungelesen markieren'), 'mail-unread'],
      [barButton('Zurückstellen'), 'clock'],
      [barButton('Verschieben'), 'folder-move'],
      [barButton('Archivieren'), 'archive'],
      [barButton('In den Papierkorb'), 'trash'],
      [railButton('Neue Nachricht'), 'compose'],
      [listRegion().getByRole('button', { name: 'Jetzt abrufen' }), 'refresh'],
      [railButton('Konto hinzufügen'), 'plus'],
      [railButton('Einstellungen'), 'settings']
    ]
    for (const [button, name] of cases) {
      const icon = button.locator(`svg[data-icon="${name}"]`)
      await page.mouse.move(5, 450)
      await sleep(350)
      const rest = await transformOf(icon)
      await button.hover()
      await sleep(150)
      const moved = await transformOf(icon)
      const hovered = await button.evaluate((el) => `${el.matches(':hover')}, (hover: hover) ${matchMedia('(hover: hover)').matches}`)
      expect(moved !== rest && moved !== 'none', `${name} bewegt sich beim Hover nicht (${rest} -> ${moved}, :hover ${hovered})`)
    }
    const reply = barButton('Antworten')
    const box = await reply.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await sleep(200)
    const pressed = await reply.evaluate((el) => getComputedStyle(el).transform)
    await page.mouse.up()
    expect(pressed !== 'none', 'Antworten gibt beim Druecken nicht nach')
    await page.keyboard.press('Escape')
    await page.mouse.move(5, 450)
  })

  console.log('Leseansicht')
  await check('Leseansicht: Zurückstellen-Menü öffnet, Esc und Klick daneben schließen, der Fokus kehrt zurück', async () => {
    await rowBySubject('Verschiebe-Test').click()
    const trigger = barButton('Zurückstellen')
    const menu = page.getByRole('menu', { name: 'Zurückstellen bis' })
    await trigger.click()
    await menu.waitFor()
    expect((await trigger.getAttribute('aria-expanded')) === 'true', 'der Auslöser zeigt das offene Menü nicht an')
    const items = await menu.getByRole('menuitem').locator('.rv-mi-label').allTextContents()
    expect(items[0] === 'In einer Stunde' && items.at(-1) === 'Zeitpunkt wählen …', `Einträge: ${JSON.stringify(items)}`)
    const metas = await menu.getByRole('menuitem').locator('.rv-mi-meta').allTextContents()
    expect(metas.length === items.length - 1 && metas.every((m) => /\d\d:\d\d$/.test(m)), `Zeitpunkte fehlen: ${JSON.stringify(metas)}`)

    await page.keyboard.press('Escape')
    await until(async () => (await menu.count()) === 0, 'Esc schließt das Menü nicht')
    expect((await focusedLabel()) === 'Zurückstellen', `nach Esc steht der Fokus auf ${await focusedLabel()}`)

    // Per Tastatur geöffnet bekommt der erste Eintrag den Fokus, die Pfeile wandern.
    await page.keyboard.press('Enter')
    await menu.waitFor()
    const focusedItem = () => page.evaluate(() => document.activeElement?.querySelector('.rv-mi-label')?.textContent)
    expect((await focusedItem()) === items[0], `erster Eintrag hat nicht den Fokus, sondern ${await focusedItem()}`)
    await page.keyboard.press('ArrowDown')
    expect((await focusedItem()) === items[1], `Pfeil runter führt nicht zum zweiten Eintrag (${await focusedItem()})`)
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    expect((await focusedItem()) === items.at(-1), 'Pfeil hoch am Anfang springt nicht ans Ende')
    // Solange das Menü offen ist, lösen Buchstaben keine Kürzel aus: E würde archivieren.
    await page.keyboard.press('e')
    await sleep(400)
    expect((await rowBySubject('Verschiebe-Test').count()) === 1, 'E im offenen Menü hat die Mail archiviert')

    await page.locator('.rv-head .rv-k').first().click()
    await until(async () => (await menu.count()) === 0, 'ein Klick daneben schließt das Menü nicht')
    await until(async () => (await focusedLabel()) === 'Zurückstellen', 'nach dem Klick daneben steht der Fokus nicht am Auslöser')

    // "Zeitpunkt wählen …" führt in den vorhandenen Dialog.
    await trigger.click()
    await menu.getByRole('menuitem', { name: 'Zeitpunkt wählen …' }).click()
    await page.waitForSelector('.overlay')
    await page.keyboard.press('Escape')
  })

  await check('Leseansicht: Verschieben-Menü filtert, Enter verschiebt auf dem Server, der eigene Ordner ist nicht wählbar', async () => {
    await rowBySubject('Verschiebe-Test').click()
    await barButton('Verschieben').click()
    const menu = page.getByRole('menu', { name: 'In Ordner verschieben' })
    await menu.waitFor()
    const field = menu.getByRole('textbox', { name: 'Ordner suchen' })
    expect(await field.evaluate((el) => el === document.activeElement), 'das Suchfeld hat nicht sofort den Fokus')
    const labels = () => menu.getByRole('menuitem').locator('.rv-mi-label').allTextContents()
    const all = await labels()
    expect(all[0] === 'Posteingang' && all[1] === 'Archiv', `Reihenfolge: ${JSON.stringify(all)}`)
    expect(!all.includes('Entwürfe') && all.includes('Arbeit'), `Ordnerliste: ${JSON.stringify(all)}`)
    const current = menu.getByRole('menuitem', { name: /Posteingang/ })
    expect((await current.getAttribute('aria-disabled')) === 'true', 'der eigene Ordner ist wählbar')
    // force: Playwright klickt nichts an, das aria-disabled traegt - genau das wird hier geprueft.
    await current.click({ force: true })
    await sleep(300)
    expect((await menu.count()) === 1 && (await rowBySubject('Verschiebe-Test').count()) === 1, 'ein Klick auf den eigenen Ordner hat etwas getan')

    await field.fill('arb')
    await until(async () => JSON.stringify(await labels()) === '["Arbeit"]', `Filter "arb" zeigt ${JSON.stringify(await labels())}`)
    await field.press('Enter')
    await until(async () => (await subjects(TIM, 'Arbeit')).some((m) => m.subject === 'Verschiebe-Test'), 'die Mail kam auf dem Server nicht in "Arbeit" an')
    expect(!(await subjects(TIM)).some((m) => m.subject === 'Verschiebe-Test'), 'die Mail liegt weiter im Posteingang')
    await until(async () => (await rowBySubject('Verschiebe-Test').count()) === 0, 'die Mail steht weiter in der Liste')
  })

  await check('Leseansicht: "Allen antworten" nur mit weiteren Empfängern, viele Anhänge klappen ein, "Alle speichern" legt alle ab', async () => {
    const tim = await imap(TIM)
    const files = Array.from({ length: 9 }, (_, i) => ({ filename: `anlage-${i + 1}.txt`, content: `Inhalt ${i + 1}`, contentType: 'text/plain' }))
    await tim.append('INBOX', await raw(mail(ANNA, TIM, 'Rundmail mit Anlagen', { cc: 'jonas@test.local, lea@test.local', attachments: files })), [])
    await tim.logout()
    await page.evaluate(() => window.api.sync.refresh())
    await until(async () => (await rowBySubject('Rundmail mit Anlagen').count()) === 1, 'Rundmail kommt nicht an', 30000)

    await rowBySubject('Bitte um Rueckruf').click()
    await page.waitForSelector('.rv-plain')
    expect((await barButton('Allen antworten').count()) === 0, '"Allen antworten" steht da, obwohl nur Tim Empfänger ist')

    await rowBySubject('Rundmail mit Anlagen').click()
    await until(async () => (await barButton('Allen antworten').count()) === 1, '"Allen antworten" fehlt bei einer Mail mit Kopie')
    const region = page.getByRole('region', { name: 'Anhänge' })
    await region.waitFor()
    expect((await region.locator('.rv-att-head').textContent()).startsWith('9 Anhänge · '), 'Kopfzeile der Anhänge stimmt nicht')
    const columns = await region.locator('.rv-att-grid').first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
    const tiles = region.locator('.rv-tile')
    expect((await tiles.count()) === 2 * columns - 1, `bei ${columns} Spalten stehen ${await tiles.count()} Kacheln da`)
    const more = region.getByRole('button', { name: `+ ${9 - (2 * columns - 1)} weitere` })
    expect((await more.count()) === 1, 'Kachel "+ n weitere" fehlt')
    await more.click()
    await until(async () => (await tiles.count()) === 9, 'nach dem Aufklappen fehlen Kacheln')

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailclient-anlagen-'))
    await app.evaluate(({ dialog }, target) => {
      globalThis.__openDialog ??= dialog.showOpenDialog
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, dir)
    try {
      await region.getByRole('button', { name: 'Alle speichern' }).click()
      await until(() => fs.readdirSync(dir).length === 9, `im Ordner liegen ${fs.readdirSync(dir).length} statt 9 Dateien`)
      await sleep(200)
      expect(fs.readFileSync(path.join(dir, 'anlage-3.txt'), 'utf8') === 'Inhalt 3', 'Inhalt eines Anhangs stimmt nicht')
    } finally {
      await app.evaluate(({ dialog }) => {
        if (globalThis.__openDialog) dialog.showOpenDialog = globalThis.__openDialog
      })
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  await check('Leseansicht: Kopf sofort aus der Liste, graue Zeilen erst nach 150 ms und dann mindestens 300 ms', async () => {
    await search('betreff:"fuellmail 121"')
    await rowBySubject('Fuellmail 121').waitFor()
    // Gemessen im Fenster selbst, vom Klick an.
    const timing = page.evaluate(
      (subject) =>
        new Promise((resolve) => {
          let clickedAt = 0
          const seen = { head: -1, skeleton: -1, skeletonGone: -1, busy: false, text: -1 }
          document.addEventListener('click', () => (clickedAt ||= performance.now()), { capture: true, once: true })
          const timer = setInterval(() => {
            if (!clickedAt) return
            const t = performance.now() - clickedAt
            if (seen.head < 0 && document.querySelector('.rv-subject')?.textContent === subject) seen.head = t
            const skeleton = document.querySelector('.rv-sk-lines')
            if (skeleton && seen.skeleton < 0) {
              seen.skeleton = t
              seen.busy = skeleton.closest('.rv-sheet')?.getAttribute('aria-busy') === 'true'
            }
            if (!skeleton && seen.skeleton >= 0 && seen.skeletonGone < 0) seen.skeletonGone = t
            if (document.querySelector('.rv-plain')?.textContent.includes(`Text von ${subject}`)) {
              seen.text = t
              clearInterval(timer)
              resolve(seen)
            }
          }, 5)
          setTimeout(() => {
            clearInterval(timer)
            resolve(seen)
          }, 20000)
        }),
      'Fuellmail 121'
    )
    imapProxy.latency = 150
    try {
      await rowBySubject('Fuellmail 121').click()
      const seen = await timing
      console.log(`         (Kopf ${Math.round(seen.head)} ms, Zeilen ${Math.round(seen.skeleton)}-${Math.round(seen.skeletonGone)} ms, Text ${Math.round(seen.text)} ms)`)
      expect(seen.text > 0, 'der Text kam nicht')
      expect(seen.head >= 0 && seen.head < 120, `der Kopf stand erst nach ${Math.round(seen.head)} ms da`)
      expect(seen.skeleton >= 140, `die grauen Zeilen kamen schon nach ${Math.round(seen.skeleton)} ms`)
      expect(seen.busy, 'das Blatt meldet aria-busy nicht')
      expect(seen.skeletonGone - seen.skeleton >= 290, `die grauen Zeilen standen nur ${Math.round(seen.skeletonGone - seen.skeleton)} ms`)
    } finally {
      imapProxy.latency = 0
    }
    await search('')
  })

  await check('Leseansicht: ein Ladefehler steht an Stelle des Blatts, "Erneut versuchen" lädt neu', async () => {
    await search('betreff:"fuellmail 122"')
    await rowBySubject('Fuellmail 122').waitFor()
    cutImap()
    try {
      await sleep(400)
      await rowBySubject('Fuellmail 122').click()
      await page.getByRole('alert').filter({ hasText: 'Diese Nachricht ließ sich nicht laden.' }).waitFor({ timeout: 20000 })
      expect((await page.locator('.rv-subject').textContent()) === 'Fuellmail 122', 'der Kopf fehlt im Fehlerzustand')
      expect((await page.locator('.rv-sheet').count()) === 0, 'das weiße Blatt steht trotz Fehler da')
    } finally {
      imapProxy.down = false
    }
    await page.getByRole('button', { name: 'Erneut versuchen' }).click()
    await until(
      async () => (await page.locator('.rv-plain').textContent().catch(() => '')).includes('Text von Fuellmail 122'),
      'nach "Erneut versuchen" kommt der Text nicht',
      20000
    )
    expect((await page.getByRole('alert').filter({ hasText: 'ließ sich nicht laden' }).count()) === 0, 'die Fehlermeldung bleibt stehen')
    await search('')
    await until(
      () => page.evaluate(() => window.api.accounts.statuses().then((s) => s.every((x) => x.phase === 'idle'))),
      'Konto erholt sich nicht von der Unterbrechung',
      90000
    )
  })

  await check('Leseansicht: Bilder zum Vergleich mit dem Entwurf', async () => {
    await portShots()
  })

  console.log('Aufteilung')
  await check('Trenner: Liste breiter ziehen, bleibt gespeichert, Doppelklick stellt zurueck', async () => {
    const width = () => listRegion().evaluate((el) => el.getBoundingClientRect().width)
    const before = await width()
    const handle = await listSplitter().boundingBox()
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 300)
    await page.mouse.down()
    // Ueber den Nachrichtenrahmen hinweg - der darf die Maus nicht abfangen.
    await page.mouse.move(handle.x + 80, handle.y + 300, { steps: 4 })
    await page.mouse.move(handle.x + 160, handle.y + 300, { steps: 4 })
    await page.mouse.up()
    await sleep(300)
    const after = await width()
    expect(Math.abs(after - before - 160) <= 4, `Liste ist ${after}px statt ${before + 160}px breit`)
    await until(async () => (await page.evaluate(() => window.api.settings.get())).listWidth === Math.round(after), 'Breite wurde nicht gespeichert')
    await shot('10-trenner')

    await reloadPage()
    expect(Math.abs((await width()) - after) <= 1, 'Breite ging beim Neuladen verloren')

    await listSplitter().dblclick()
    await until(async () => Math.abs((await width()) - 384) <= 1, 'Doppelklick stellt nicht zurueck')
  })

  await check('Trenner: zu weit gezogen laesst dem Lesebereich Platz', async () => {
    const handle = await listSplitter().boundingBox()
    await page.mouse.move(handle.x + 3, handle.y + 300)
    await page.mouse.down()
    await page.mouse.move(handle.x + 2000, handle.y + 300, { steps: 6 })
    await page.mouse.up()
    await sleep(300)
    const reader = await page.getByRole('region', { name: 'Nachricht', exact: true }).evaluate((el) => el.getBoundingClientRect().width)
    expect(reader >= 419, `Lesebereich ist nur ${reader}px breit`)
    await listSplitter().dblclick()
  })

  await check('Trenner: Lesebereich unten - Hoehe der Liste ziehen', async () => {
    await page.evaluate(() => window.api.settings.update({ previewPosition: 'bottom' }))
    await page.getByRole('separator', { name: 'Höhe der Liste' }).waitFor()
    const height = () => listRegion().evaluate((el) => el.getBoundingClientRect().height)
    const before = await height()
    const handle = await listSplitter().boundingBox()
    // Der Griff ragt halb in den Lesebereich; auch dort muss er oben liegen, nicht dessen Leiste.
    for (const dy of [handle.height / 2, handle.height - 1.5]) {
      const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[role="separator"]') !== null, [handle.x + 200, handle.y + dy])
      expect(hit, `${dy.toFixed(1)} px unter der Oberkante des Trenners liegt etwas anderes über ihm`)
    }
    await page.mouse.move(handle.x + 200, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + 200, handle.y - 120, { steps: 5 })
    await page.mouse.up()
    await sleep(300)
    const after = await height()
    expect(Math.abs(before - 120 - after) <= 4, `Liste ist ${after}px statt ${before - 120}px hoch`)
    await listSplitter().dblclick()
    await page.evaluate(() => window.api.settings.update({ previewPosition: 'right' }))
    await page.getByRole('separator', { name: 'Breite der Liste' }).waitFor()
  })

  console.log('Liste und Seitenleiste')
  await check('Ordner: Kontogruppe und „Eigene Ordner“ klappen auf und zu, der Stand übersteht ein Neuladen', async () => {
    // Der Kopf der Gruppe: ihr erster Knopf. Sein Name wechselt mit Zahl und Fehler.
    const group = () => folderColumn().getByRole('group', { name: 'Test', exact: true }).getByRole('button').first()
    const own = () => folderColumn().getByRole('button', { name: /^Eigene Ordner/ })
    const inboxes = () => folderColumn().getByRole('button', { name: /^Posteingang ?\d*$/ })
    expect((await group().getAttribute('aria-expanded')) === 'true', 'die Kontogruppe ist anfangs zu')
    expect((await own().getAttribute('aria-expanded')) === 'false', '„Eigene Ordner“ ist anfangs offen')
    expect((await folderItem('Arbeit').count()) === 0, 'der eigene Ordner „Arbeit“ steht trotz zugeklappter Gruppe da')
    expect((await inboxes().count()) === 2, 'Sammelansicht und Konto sollten je einen Posteingang zeigen')

    await own().click()
    await folderItem('Arbeit').waitFor()
    await group().click()
    await until(async () => (await group().getAttribute('aria-expanded')) === 'false', 'die Gruppe klappt nicht zu')
    expect((await inboxes().count()) === 1 && (await folderItem('Arbeit').count()) === 0, 'eine zugeklappte Gruppe zeigt noch Ordner')
    await until(async () => {
      const saved = (await page.evaluate(() => window.api.settings.get())).folderGroups
      return Object.values(saved).filter((v) => v === false).length === 1 && Object.values(saved).includes(true)
    }, 'der Stand der Gruppen wird nicht gespeichert')

    await reloadPage()
    await group().waitFor()
    expect((await group().getAttribute('aria-expanded')) === 'false', 'nach dem Neuladen ist die Gruppe wieder offen')
    await group().click()
    await folderItem('Arbeit').waitFor({ timeout: 5000 })
    expect((await own().getAttribute('aria-expanded')) === 'true', '„Eigene Ordner“ vergaß beim Neuladen, dass es offen war')
    await shot('liste-eigene-ordner')
    await own().click()
    await until(async () => (await folderItem('Arbeit').count()) === 0, '„Eigene Ordner“ klappt nicht wieder zu')
  })

  await check('Abrufstand: „Wird abgerufen …“, danach „Aktuell“; ein Fehler bleibt mit „Erneut“ stehen', async () => {
    const status = listRegion().getByRole('status')
    const text = () => status.textContent()
    const refresh = () => listRegion().getByRole('button', { name: 'Jetzt abrufen' })
    const idle = () =>
      until(
        () => page.evaluate(() => window.api.accounts.statuses().then((s) => s.every((x) => x.phase === 'idle'))),
        'Konto kommt nicht zur Ruhe',
        90000
      )
    await idle()
    imapProxy.latency = 120
    try {
      await refresh().click()
      await until(async () => (await text()).includes('Wird abgerufen …'), `kein „Wird abgerufen …“ (${await text()})`, 5000)
      const spinning = await refresh().locator('svg').evaluate((el) => getComputedStyle(el).animationName)
      expect(spinning === 'lv-spin', `das Symbol am Abruf-Knopf dreht sich nicht (${spinning})`)
      expect((await refresh().textContent()).trim() === '', 'der Abruf-Knopf trägt wieder eine Beschriftung')
    } finally {
      imapProxy.latency = 0
    }
    await until(async () => (await text()).includes('Aktuell'), `nach dem Abruf kein „Aktuell“ (${await text()})`, 90000)

    cutImap()
    try {
      await until(async () => (await text()).includes('Test offline'), `kein Fehler nach dem Abbruch (${await text()})`, 20000)
      await status.getByRole('button', { name: 'Erneut' }).waitFor()
      await shot('liste-abruf-fehler')
      // Die App verbindet nach 5 s von selbst neu; der Fehler darf dabei nicht verschwinden.
      await sleep(7000)
      expect((await text()).includes('Test offline'), `der Fehler verschwand, ohne dass etwas gelöst wurde (${await text()})`)
    } finally {
      imapProxy.down = false
    }
    await status.getByRole('button', { name: 'Erneut' }).click()
    await until(async () => !(await text()).includes('offline'), 'nach „Erneut“ steht der Fehler weiter da', 5000)
    await until(async () => (await text()).includes('Aktuell'), `nach „Erneut“ kein „Aktuell“ (${await text()})`, 90000)
    expect((await status.getByRole('button', { name: 'Erneut' }).count()) === 0, '„Erneut“ bleibt nach dem Erfolg stehen')
    await idle()
  })

  await check('Liste: der Punkt ist ein Knopf und schaltet per Tastatur auf ungelesen und zurück', async () => {
    const row = rowBySubject('Fliesstext-Test')
    await row.click()
    const dot = row.getByRole('button', { name: /^Als (un)?gelesen markieren$/ })
    await until(async () => (await row.getAttribute('data-unread')) === 'false', 'die Mail ist nicht gelesen')
    expect((await dot.getAttribute('aria-label')) === 'Als ungelesen markieren' && (await dot.getAttribute('aria-pressed')) === 'false', 'der Punkt beschreibt sich falsch')
    expect((await dot.getAttribute('tabindex')) === '0', 'der Punkt der offenen Zeile ist per Tab nicht erreichbar')
    await dot.focus()
    await page.keyboard.press('Space')
    await until(async () => (await row.getAttribute('data-unread')) === 'true', 'Leertaste setzt die Mail nicht auf ungelesen')
    await until(async () => (await subjects(TIM)).find((m) => m.subject === 'Fliesstext-Test')?.seen === false, 'Server kennt die Mail nicht als ungelesen')
    // Die Zeile bleibt offen, und das Gelesen-Markieren dreht es nicht gleich zurück.
    await sleep(800)
    expect((await row.getAttribute('data-unread')) === 'true', 'die offene Mail wurde sofort wieder gelesen')
    expect((await dot.getAttribute('aria-label')) === 'Als gelesen markieren' && (await dot.getAttribute('aria-pressed')) === 'true', 'der Punkt meldet den neuen Stand nicht')
    await page.keyboard.press('Enter')
    await until(async () => (await row.getAttribute('data-unread')) === 'false', 'Enter setzt die Mail nicht auf gelesen')
    await until(async () => (await subjects(TIM)).find((m) => m.subject === 'Fliesstext-Test')?.seen, 'Server kennt die Mail nicht als gelesen')
  })

  await check('Mehrfachauswahl: Kästchen statt Punkt, die Leiste darüber archiviert beide Mails', async () => {
    const tim = await imap(TIM)
    for (const subject of ['Auswahl Eins', 'Auswahl Zwei']) await tim.append('INBOX', await raw(mail(ANNA, TIM, subject)), ['\\Seen'])
    await tim.logout()
    await page.evaluate(() => window.api.sync.refresh())
    await until(async () => (await rowBySubject('Auswahl').count()) === 2, 'die zwei Mails kommen nicht an', 30000)

    await rowBySubject('Auswahl Eins').click()
    await rowBySubject('Auswahl Zwei').click({ modifiers: ['Control'] })
    const rows = await messageList().getByRole('option').count()
    await until(async () => (await messageList().locator('.lv-cb').count()) === rows, 'nicht jede Zeile zeigt ein Kästchen')
    expect((await messageList().getByRole('button', { name: /^Als (un)?gelesen markieren$/ }).count()) === 0, 'in der Mehrfachauswahl stehen noch Punkte')
    expect((await messageList().getByRole('option', { selected: true }).count()) === 2, 'nicht genau zwei Zeilen sind ausgewählt')
    expect((await listRegion().getByRole('heading', { name: '2 ausgewählt' }).count()) === 1, 'die Unterzeile nennt die Auswahl nicht')
    const pane = page.getByRole('region', { name: 'Auswahl' })
    expect((await pane.getByRole('heading', { name: '2 Nachrichten ausgewählt' }).count()) === 1, 'der Lesebereich nennt die Auswahl nicht')
    expect((await pane.getByText('Auswahl aufheben', { exact: true }).count()) === 1, 'der Hinweis auf Esc fehlt')
    expect((await pane.getByRole('button', { name: 'Auswahl aufheben' }).count()) === 0, 'der alte Knopf „Auswahl aufheben“ steht noch da')

    // Das Kästchen einer dritten Zeile nimmt sie dazu, ein zweiter Klick wieder heraus.
    const third = rowBySubject('Teammeeting')
    await third.locator('.lv-cb').click()
    await until(async () => (await messageList().getByRole('option', { selected: true }).count()) === 3, 'das Kästchen nimmt die Zeile nicht dazu')
    await third.locator('.lv-cb').click()
    await until(async () => (await messageList().getByRole('option', { selected: true }).count()) === 2, 'ein zweiter Klick nimmt die Zeile nicht heraus')
    await shot('liste-mehrfach')

    await pane.getByRole('toolbar', { name: 'Aktionen für die Auswahl' }).getByRole('button', { name: 'Archivieren', exact: true }).click()
    await until(async () => (await subjects(TIM, 'Archive')).filter((m) => m.subject.startsWith('Auswahl')).length === 2, 'nicht beide Mails kamen im Archiv an')
    expect(!(await subjects(TIM)).some((m) => m.subject.startsWith('Auswahl')), 'eine der Mails liegt weiter im Posteingang')
    await until(async () => (await rowBySubject('Auswahl').count()) === 0, 'die Mails stehen weiter in der Liste')
  })

  await check('Schmales Fenster: keine Ordnerspalte, der Titel öffnet die Ordner als Menü', async () => {
    await page.setViewportSize({ width: 1150, height: 900 })
    try {
      await until(async () => (await folderColumn().count()) === 0, 'die Ordnerspalte steht im schmalen Fenster da')
      const trigger = listRegion().getByRole('button', { name: 'Posteingang', exact: true })
      await trigger.click()
      const menu = page.getByRole('menu', { name: 'Ordner' })
      await menu.waitFor()
      expect((await trigger.getAttribute('aria-expanded')) === 'true', 'der Titel zeigt das offene Menü nicht an')
      await shot('liste-schmal-menue')
      await menu.getByRole('menuitem', { name: /^Anhänge/ }).click()
      await until(async () => (await menu.count()) === 0, 'eine Wahl schließt das Menü nicht')
      const picked = listRegion().getByRole('button', { name: 'Anhänge', exact: true })
      await picked.waitFor()
      await until(async () => (await focusedLabel())?.includes('Anhänge'), `der Fokus kehrt nicht zum Titel zurück (${await focusedLabel()})`)
      await until(async () => (await rowTexts()).includes('Rechnung 4711'), 'die Ansicht „Anhänge“ kommt nicht')

      // Per Tastatur: Enter öffnet mit dem ersten Eintrag im Fokus, Esc schließt.
      await page.keyboard.press('Enter')
      await menu.waitFor()
      const focused = () => page.evaluate(() => document.activeElement?.textContent)
      expect((await focused())?.startsWith('Posteingang'), `der erste Eintrag hat nicht den Fokus (${await focused()})`)
      await page.keyboard.press('ArrowDown')
      expect((await focused())?.startsWith('Ungelesen'), `Pfeil runter führt nicht weiter (${await focused()})`)
      await page.keyboard.press('Escape')
      await until(async () => (await menu.count()) === 0, 'Esc schließt das Menü nicht')
      await picked.click()
      await menu.getByRole('menuitem', { name: /^Posteingang/ }).first().click()
      await listRegion().getByRole('button', { name: 'Posteingang', exact: true }).waitFor()
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 })
    }
    await folderColumn().waitFor()
  })

  await check('Suche: die Kürzel-Hilfe öffnet am leeren Feld und setzt „von:“ ein', async () => {
    const help = page.getByRole('listbox', { name: 'Suchkürzel' })
    await searchBox().click()
    await help.waitFor()
    const options = help.getByRole('option')
    expect((await options.count()) === 9, `die Hilfe zeigt ${await options.count()} statt 9 Kürzel`)
    expect((await searchBox().getAttribute('aria-expanded')) === 'true', 'das Feld meldet die offene Hilfe nicht')
    await page.keyboard.press('ArrowDown')
    const active = await searchBox().getAttribute('aria-activedescendant')
    expect(active && (await help.locator(`[id="${active}"]`).textContent()).startsWith('von:'), 'Pfeil runter wählt nicht „von:“')
    await shot('liste-suche-hilfe')
    await page.keyboard.press('Enter')
    expect((await searchBox().inputValue()) === 'von:', `Enter setzt „${await searchBox().inputValue()}“ ein`)
    expect(await searchBox().evaluate((el) => el === document.activeElement), 'der Fokus verließ das Feld')
    await until(async () => (await help.count()) === 0, 'die Hilfe bleibt nach der Wahl offen')

    await page.keyboard.type('anna')
    await sleep(700)
    const texts = await rowTexts()
    expect(texts.length > 0 && texts.every((t) => !t.startsWith('Fuellmail')), `von:anna findet ${JSON.stringify(texts)}`)
    expect((await listRegion().locator('.lv-sf-mirror .lv-tok').textContent()) === 'von:anna', 'das Kürzel ist im Feld nicht hervorgehoben')
    expect((await messageList().locator('mark').first().textContent()).toLowerCase() === 'anna', 'der Treffer im Absender ist nicht markiert')
    expect((await listRegion().getByRole('heading', { name: /^\d+ Treffer$/ }).count()) === 1, 'die Unterzeile nennt die Treffer nicht')
    await shot('liste-suche-treffer')

    // Die Spiegelschicht muss genau so breit sein wie der Text im Feld, auch mit Leerzeichen
    // zwischen zwei Kürzeln - sonst steht der Cursor neben dem gezeichneten Text.
    await page.keyboard.type(' an:tim')
    const widths = await listRegion().locator('.lv-sf-mirror > span').evaluate((mirror) => {
      const input = document.querySelector('.lv-sf-input')
      const probe = document.createElement('span')
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${getComputedStyle(input).font}`
      probe.textContent = input.value
      document.body.append(probe)
      const plain = probe.getBoundingClientRect().width
      probe.remove()
      return { mirror: mirror.getBoundingClientRect().width, plain, tokens: mirror.querySelectorAll('.lv-tok').length, value: input.value, focused: document.activeElement?.className }
    })
    expect(widths.tokens === 2, `erwartet zwei hervorgehobene Kürzel, gefunden ${JSON.stringify(widths)}`)
    expect(Math.abs(widths.mirror - widths.plain) < 1.5, `Spiegel ${widths.mirror} px, Feldtext ${widths.plain} px`)

    // Esc leert, ein zweites Esc verlässt das Feld.
    await page.keyboard.press('Escape')
    expect((await searchBox().inputValue()) === '', 'Esc leert das Feld nicht')
    await page.keyboard.press('Escape')
    expect(await searchBox().evaluate((el) => el !== document.activeElement), 'das zweite Esc verlässt das Feld nicht')

    // Ein Klick setzt ein Kürzel ohne Wert samt Leerzeichen ein.
    await searchBox().click()
    await help.getByRole('option', { name: /^hat:anhang/ }).click()
    expect((await searchBox().inputValue()) === 'hat:anhang ', `der Klick setzt „${await searchBox().inputValue()}“ ein`)
    await sleep(700)
    await search('')
  })

  console.log('Rechtsklick')
  await check('Rechtsklick: öffnet die Mail nicht, „Als ungelesen markieren“ bleibt stehen', async () => {
    await reset()
    // Erst eine andere Mail öffnen, damit klar ist, was der Lesebereich zeigt.
    await rowBySubject('Fliesstext-Test').click()
    const row = rowBySubject('Bitte um Rueckruf')
    await until(async () => (await row.count()) === 1, 'Bitte um Rueckruf fehlt')
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: /ungelesen/ }).click()
    await sleep(1500)
    expect((await row.getAttribute('data-unread')) === 'true', 'die Mail ist nicht ungelesen geblieben')
    expect((await row.getAttribute('data-open')) === null, 'der Rechtsklick hat die Mail geöffnet')
    expect(!(await subjects(TIM)).find((m) => m.subject === 'Bitte um Rueckruf')?.seen, 'der Server kennt die Mail als gelesen')
    // Zurück auf gelesen, damit andere Tests den alten Stand vorfinden.
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: /gelesen markieren/ }).click()
  })

  console.log('Ziehen')
  await check('Ziehen: Mail auf einen Ordner ziehen, zugeklappte Ordner gehen beim Verweilen auf', async () => {
    await reset()
    const row = rowBySubject('Zieh-Test')
    await until(async () => (await row.count()) === 1, 'Zieh-Test steht nicht in der Liste')
    const own = folderColumn().getByRole('button', { name: /^Eigene Ordner/ })
    if ((await own.getAttribute('aria-expanded')) === 'true') await own.click()
    await until(async () => (await folderItem('Arbeit').count()) === 0, '„Eigene Ordner“ ist offen geblieben')

    const from = await row.boundingBox()
    const ownBox = await own.boundingBox()
    await page.mouse.move(from.x + 60, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 80, from.y + from.height / 2, { steps: 3 })
    await page.mouse.move(ownBox.x + 40, ownBox.y + ownBox.height / 2, { steps: 8 })
    await holdStill(ownBox.x + 40, ownBox.y + ownBox.height / 2)
    // Unterwegs: die Zeile tritt zurueck, Sammelansichten nehmen nichts und sind gedimmt, das Briefchen folgt.
    await until(async () => (await row.getAttribute('data-lifted')) !== null, 'die gezogene Zeile tritt nicht zurueck', 3000)
    expect((await folderItem('Markiert').getAttribute('data-dim')) !== null, '„Markiert“ ist beim Ziehen nicht gedimmt')
    const token = dragToken()
    expect((await token.count()) === 1, 'kein Briefchen am Zeiger')
    expect((await token.locator('.lv-env-cnt').count()) === 0, 'eine einzelne Mail zeigt eine Zahl am Briefchen')
    await until(async () => near(await tokenAt(), { x: ownBox.x + 40, y: ownBox.y + ownBox.height / 2 }), 'das Briefchen folgt dem Zeiger nicht', 3000)
    // Verweilen: „Eigene Ordner“ klappt von selbst auf.
    await until(async () => (await own.getAttribute('aria-expanded')) === 'true', '„Eigene Ordner“ geht beim Verweilen nicht auf', 3000)
    const target = folderItem('Arbeit')
    await target.waitFor()
    const targetBox = await target.boundingBox()
    await page.mouse.move(targetBox.x + 40, targetBox.y + targetBox.height / 2, { steps: 6 })
    await holdStill(targetBox.x + 40, targetBox.y + targetBox.height / 2)
    expect((await target.getAttribute('data-drop')) === 'ok', 'Arbeit zeigt sich nicht als Ziel')
    await until(async () => near(await tokenAt(), { x: targetBox.x + 40, y: targetBox.y + targetBox.height / 2 }), 'das Briefchen bleibt hinter dem Zeiger zurueck', 3000)
    await shot('ziehen-gueltig')
    const sank = await watchTokenFlight()
    await page.mouse.up()
    expect(await sank(), 'das Briefchen gleitet beim Ablegen nicht in den Ordner')

    await until(async () => (await subjects(TIM, 'Arbeit')).some((m) => m.subject === 'Zieh-Test'), 'Mail kam nicht in Arbeit an')
    expect(!(await subjects(TIM)).some((m) => m.subject === 'Zieh-Test'), 'Mail liegt weiter im Posteingang')
    await until(async () => (await row.count()) === 0, 'Zeile steht weiter in der Liste')
    expect((await target.getAttribute('data-drop')) === null, 'Ziel bleibt nach dem Ablegen markiert')
    expect((await dragToken().count()) === 0, 'das Briefchen bleibt am Zeiger haengen')
    await until(async () => (await page.locator('.lv-env-fly').count()) === 0, 'das Briefchen bleibt nach dem Ablegen stehen', 3000)

    // Die Meldung bietet Rückgängig als echten Knopf; der holt die Mail zurueck.
    const undo = toast().getByRole('button', { name: 'Rückgängig' })
    await until(async () => (await undo.count()) === 1, 'kein Rückgängig-Knopf')
    await shot('ziehen-abgelegt')
    await until(async () => (await toast().textContent().catch(() => '')).includes('1 Mail nach Arbeit verschoben'), 'Meldung fehlt')
    await undo.click()
    await until(async () => (await subjects(TIM)).some((m) => m.subject === 'Zieh-Test'), 'Rückgängig holt die Mail nicht in den Posteingang')
    expect(!(await subjects(TIM, 'Arbeit')).some((m) => m.subject === 'Zieh-Test'), 'die Mail liegt nach Rückgängig weiter in Arbeit')
    await until(async () => (await rowBySubject('Zieh-Test').count()) === 1, 'Zeile kommt nach Rückgängig nicht zurück', 20000)
  })

  await check('Liste: der Papierkorb beim Hovern loescht die Zeile, Rueckgaengig holt sie zurueck', async () => {
    const client = await imap(TIM)
    try {
      await client.append('INBOX', await raw(mail('werbung@shop.example', TIM, 'Papierkorb-Hover-Test', { text: 'Weg damit.' })))
      await client.append('Trash', await raw(mail('alt@shop.example', TIM, 'Liegt schon im Papierkorb', { text: 'alt' })), ['\\Seen'])
    } finally {
      await client.logout().catch(() => {})
    }
    await page.evaluate(() => window.api.sync.refresh())
    const row = rowBySubject('Papierkorb-Hover-Test')
    await until(async () => (await row.count()) === 1, 'neue Mail fehlt in der Liste')
    const del = row.getByRole('button', { name: 'In den Papierkorb' })
    const shown = () => del.evaluate((el) => getComputedStyle(el).transform === 'none')
    // Ueber der Mitte der Zeile bleibt er drin, erst am rechten Rand faehrt er heraus.
    await row.hover()
    await sleep(400)
    expect(!(await shown()), 'Papierkorb faehrt schon beim Hovern der Mitte heraus')
    const box = await row.boundingBox()
    await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2)
    await until(shown, 'Papierkorb faehrt am rechten Rand nicht heraus')
    await sleep(300)
    await freshShot('port-papierkorb')
    // Ein Briefchen fliegt zum Papierkorb und ist danach wieder weg; die Zeile klappt zu, bis die Daten sie entfernen.
    const flew = await watchTokenFlight()
    await del.click()
    expect(await flew(), 'kein Briefchen fliegt zum Papierkorb')
    await until(async () => (await page.locator('.lv-env-fly').count()) === 0, 'das Briefchen bleibt nach dem Flug stehen', 3000)
    await until(async () => (await row.count()) === 0, 'Zeile bleibt stehen')
    await until(async () => (await subjects(TIM, 'Trash')).some((m) => m.subject === 'Papierkorb-Hover-Test'), 'Mail fehlt im Papierkorb')
    await toast().locator('.toast-action', { hasText: 'Rückgängig' }).click()
    await until(async () => (await subjects(TIM)).some((m) => m.subject === 'Papierkorb-Hover-Test'), 'Rueckgaengig holt sie nicht zurueck')

    // Im Papierkorb selbst gibt es den Knopf nicht.
    await railButton(`Test · ${TIM}`).click()
    await folderItem('Papierkorb').click()
    await page.evaluate(() => window.api.accounts.list().then((a) => window.api.sync.refresh(a[0].id, 'Trash')))
    await until(async () => (await rowBySubject('Liegt schon im Papierkorb').count()) === 1, 'Papierkorb wird nicht gezeigt')
    await until(async () => (await messageList().getByRole('button', { name: 'In den Papierkorb' }).count()) === 0, 'Papierkorb-Knopf im Papierkorb')
  })

  await check('Liste: Entf, Rechtsklick und Leiste schicken ein Briefchen zum Papierkorb, mehrere mit Zahl', async () => {
    const names = ['Flug-Entf', 'Flug-Menue', 'Flug-Leiste', 'Flug-Paar-1', 'Flug-Paar-2', 'Flug-Ruhig']
    const client = await imap(TIM)
    try {
      for (const name of names) await client.append('INBOX', await raw(mail('flug@shop.example', TIM, name, { text: 'Weg.' })))
    } finally {
      await client.logout().catch(() => {})
    }
    await page.evaluate(() => window.api.sync.refresh())
    for (const name of names) await until(async () => (await rowBySubject(name).count()) === 1, `${name} fehlt in der Liste`)
    const gone = async (name) => {
      await until(async () => (await rowBySubject(name).count()) === 0, `${name} bleibt in der Liste`)
      await until(async () => (await subjects(TIM, 'Trash')).some((m) => m.subject === name), `${name} fehlt im Papierkorb`)
    }

    await rowBySubject('Flug-Entf').click()
    let flew = await watchTokenFlight()
    await page.keyboard.press('Delete')
    expect((await flew()) === '1', 'Entf schickt kein Briefchen')
    await gone('Flug-Entf')

    await rowBySubject('Flug-Menue').click({ button: 'right' })
    flew = await watchTokenFlight()
    await page.getByRole('menuitem', { name: 'In den Papierkorb' }).click()
    expect((await flew()) === '1', 'der Rechtsklick schickt kein Briefchen')
    await gone('Flug-Menue')

    await rowBySubject('Flug-Leiste').click()
    flew = await watchTokenFlight()
    await barButton('In den Papierkorb').click()
    expect((await flew()) === '1', 'die Leiste schickt kein Briefchen')
    await gone('Flug-Leiste')

    // Zwei Zeilen zusammen: ein Briefchen mit der Zahl 2.
    await rowBySubject('Flug-Paar-1').click()
    await rowBySubject('Flug-Paar-2').click({ modifiers: ['Control'] })
    flew = await watchTokenFlight()
    await page.keyboard.press('Delete')
    const count = await flew()
    expect(count === '2', `zwei Mails fliegen nicht als ein Briefchen mit 2 (${count})`)
    await gone('Flug-Paar-1')
    await gone('Flug-Paar-2')

    // Weniger Bewegung: kein Flug, die Zeile geht trotzdem.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    try {
      await rowBySubject('Flug-Ruhig').click()
      flew = await watchTokenFlight()
      await page.keyboard.press('Delete')
      expect((await flew()) === false, 'mit weniger Bewegung fliegt trotzdem ein Briefchen')
      await gone('Flug-Ruhig')
    } finally {
      await page.emulateMedia({ reducedMotion: null })
    }
  })

  await check('Liste: ist die Kontogruppe zugeklappt, fliegt das Briefchen zu ihrem Kopf', async () => {
    const client = await imap(TIM)
    try {
      await client.append('INBOX', await raw(mail('werbung@shop.example', TIM, 'Zugeklappt-Flug-Test', { text: 'Weg damit.' })))
    } finally {
      await client.logout().catch(() => {})
    }
    await page.evaluate(() => window.api.sync.refresh())
    const row = rowBySubject('Zugeklappt-Flug-Test')
    await until(async () => (await row.count()) === 1, 'neue Mail fehlt in der Liste')
    const group = () => folderColumn().getByRole('group', { name: 'Test', exact: true }).getByRole('button').first()
    if ((await group().getAttribute('aria-expanded')) === 'true') await group().click()
    await until(async () => (await group().getAttribute('aria-expanded')) === 'false', 'die Gruppe klappt nicht zu')
    try {
      const box = await row.boundingBox()
      await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2)
      await sleep(300)
      const flew = await watchTokenFlight()
      await row.getByRole('button', { name: 'In den Papierkorb' }).click()
      expect(await flew(), 'kein Briefchen, obwohl die Gruppe nur zugeklappt ist')
      await until(async () => (await row.count()) === 0, 'Zeile bleibt stehen')
    } finally {
      await group().click()
    }
  })

  await check('Ziehen: eine Sammelansicht nimmt keine Mails an', async () => {
    await reset()
    const row = rowBySubject('Teammeeting')
    const from = await row.boundingBox()
    const flagged = folderItem('Markiert')
    const box = await flagged.boundingBox()
    await page.mouse.move(from.x + 60, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 80, from.y + from.height / 2, { steps: 3 })
    await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 8 })
    expect((await flagged.getAttribute('data-drop')) === 'no', '„Markiert“ zeigt sich nicht als ungültiges Ziel')
    expect((await dragToken().getAttribute('data-refused')) !== null, 'das Briefchen wird über einem ungültigen Ziel nicht grau')
    await shot('ziehen-ungueltig')
    // Losgelassen ueber keinem gueltigen Ziel: das Briefchen fliegt zur Zeile zurueck.
    const flewBack = await watchTokenFlight()
    await page.mouse.up()
    expect(await flewBack(), 'das Briefchen fliegt nach dem Abbruch nicht zurueck')
    await sleep(800)
    expect((await page.locator('.lv-env-drag, .lv-env-fly').count()) === 0, 'nach dem Abbruch bleibt ein Briefchen stehen')
    expect((await subjects(TIM)).some((m) => m.subject === 'Teammeeting'), 'Teammeeting hat den Posteingang verlassen')
  })

  console.log('Bestehendes')
  await check('Bestand: Antworten fuellt Empfaenger, Betreff und Zitat', async () => {
    await rowBySubject('Bitte um Rueckruf').click()
    await page.waitForSelector('.rv-subject')
    await sleep(600)
    await barButton('Antworten').click()
    await page.waitForSelector('.compose-dialog')
    expect((await page.inputValue('#compose-subject')) === 'Re: Bitte um Rueckruf', 'Betreff stimmt nicht')
    expect((await recipientChip('chef@firma.example').count()) === 1, 'Empfaenger fehlt')
    expect((await page.locator('.compose-editor').innerText()).includes('Ruf mich bitte an.'), 'Zitat fehlt')
    await page.keyboard.press('Escape')
  })

  await check('Bestand: markieren, ungelesen, archivieren, loeschen', async () => {
    await rowBySubject('Bitte um Rueckruf').click()
    await page.keyboard.press('s')
    await until(async () => (await subjects(TIM)).find((m) => m.subject === 'Bitte um Rueckruf')?.flagged, 'Markierung kam nicht beim Server an')
    await folderItem('Markiert').click()
    await until(async () => (await rowBySubject('Bitte um Rueckruf').count()) === 1, 'fehlt unter "Markiert"')
    await folderItem('Posteingang').click()

    await rowBySubject('Bitte um Rueckruf').click()
    await page.keyboard.press('e')
    await until(async () => (await subjects(TIM, 'Archive')).some((m) => m.subject === 'Bitte um Rueckruf'), 'Archivieren kam nicht beim Server an')
    expect((await rowBySubject('Bitte um Rueckruf').count()) === 0, 'archivierte Mail steht weiter im Posteingang')

    await rowBySubject('Newsletter Herbst').click()
    await page.keyboard.press('Delete')
    await until(async () => (await subjects(TIM, 'Trash')).some((m) => m.subject === 'Newsletter Herbst'), 'Loeschen kam nicht beim Server an')
  })

  await check('Bestand: Archivieren einer Unterhaltung nimmt alle Mails der Zeile mit', async () => {
    await rowBySubject('Projektplan').click()
    await page.keyboard.press('e')
    await until(
      async () => (await subjects(TIM, 'Archive')).filter((m) => /Projektplan/.test(m.subject)).length === 2,
      'nicht beide Posteingangs-Mails der Unterhaltung wurden archiviert'
    )
    expect(!(await subjects(TIM)).some((m) => /Projektplan/.test(m.subject)), 'im Posteingang blieb ein Teil der Unterhaltung liegen')
    expect((await subjects(TIM, 'Sent')).some((m) => m.subject === 'Re: Projektplan'), 'die eigene Antwort in Gesendet wurde mit verschoben')
  })

  await check('Bestand: neue Post kommt an und landet in ihrer Unterhaltung', async () => {
    const transport = nodemailer.createTransport({ host: HOST, port: 3465, secure: true, tls: { rejectUnauthorized: false } })
    await transport.sendMail(mail(ANNA, TIM, 'Re: Altes Thema', { messageId: '<alt-3@test.local>', inReplyTo: '<alt-2@test.local>', references: ['<alt-1@test.local>', '<alt-2@test.local>'], text: 'Noch ein Nachtrag.' }))
    transport.close()
    await page.evaluate(() => window.api.sync.refresh())
    await until(async () => (await threadCount(rowBySubject('Re: Altes Thema')).textContent().catch(() => '')) === '3', 'neue Antwort wurde nicht in die Unterhaltung einsortiert', 30000)
    expect((await rowBySubject('Re: Altes Thema').count()) === 1, 'Unterhaltung steht doppelt in der Liste')
  })

  await check('Liste: Bilder zum Vergleich mit dem Entwurf', async () => {
    await listShots()
  })

  await shot('08-ende')

  // Zuletzt, weil es die App beendet: ein offenes, ungespeichertes Fenster landet vorher in Entwuerfe.
  let quit = false
  await check('Entwurf: Beenden speichert offene Fenster als Entwurf', async () => {
    await clearFolder(TIM, 'Drafts')
    await openComposer()
    await fillComposer({ to: ANNA, subject: 'Beenden-Test', body: 'kurz vor Schluss' })
    const closed = new Promise((resolve) => app.once('close', resolve))
    quit = true
    await app.evaluate(({ app: electronApp }) => electronApp.quit())
    await closed
    const saved = await draftsOf()
    expect(saved.some((d) => d.subject === 'Beenden-Test' && d.source.includes('kurz vor Schluss')), 'Beenden hat den Entwurf nicht gespeichert')
  })
  proxyServer.close()
  if (!quit) await app.close()
  fs.rmSync(userData, { recursive: true, force: true })

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length} von ${results.length} bestanden.`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(async (err) => {
  console.error('Abbruch:', err)
  await app?.close().catch(() => {})
  process.exit(2)
})

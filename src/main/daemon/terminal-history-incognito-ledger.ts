import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const LEDGER_FILE = '.incognito-sessions.json'

/**
 * Durable "do-not-record" list of incognito ("no-session") session ids.
 *
 * Why persist: a daemon/app restart replaces the daemon and re-adopts (or revives) the still-live
 * shell under the SAME session id, on a fresh HistoryManager whose in-memory mark is gone — which is
 * exactly how an incognito terminal silently started recording again after a restart. Loading this
 * ledger on startup means openSession/registerWriter recognize that id and keep writing nothing.
 *
 * It stores ONLY opaque session ids (which already encode the worktree/cwd, the same as a normal
 * history dir name) — never scrollback. It is a privacy-protecting record, the inverse of capture.
 */
export class IncognitoSessionLedger {
  private readonly ids = new Set<string>()
  private readonly path: string

  constructor(basePath: string) {
    this.path = join(basePath, LEDGER_FILE)
    try {
      if (existsSync(this.path)) {
        const parsed = JSON.parse(readFileSync(this.path, 'utf8'))
        if (Array.isArray(parsed)) {
          for (const id of parsed) {
            if (typeof id === 'string') {
              this.ids.add(id)
            }
          }
        }
      }
    } catch {
      // Best-effort: a corrupt/unreadable ledger starts empty rather than blocking startup.
    }
  }

  has(sessionId: string): boolean {
    return this.ids.has(sessionId)
  }

  mark(sessionId: string): void {
    if (!this.ids.has(sessionId)) {
      this.ids.add(sessionId)
      this.persist()
    }
  }

  forget(sessionId: string): void {
    if (this.ids.delete(sessionId)) {
      this.persist()
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      // Why tmp+rename: a torn write must not corrupt the ledger; a stale-but-whole one is recoverable.
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify([...this.ids]), { mode: 0o600 })
      renameSync(tmp, this.path)
    } catch {
      // Best-effort durability; an unwritable ledger still gates in-memory for this process.
    }
  }
}

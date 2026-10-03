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
  /** Subset of `ids` proven to be on disk, so a transient persist failure is retried, not forgotten. */
  private readonly persisted = new Set<string>()
  private readonly path: string
  /** True when a ledger file EXISTED at startup but could not be read/parsed — a fail-OPEN risk. */
  private loadFailed = false

  constructor(basePath: string) {
    this.path = join(basePath, LEDGER_FILE)
    const existed = existsSync(this.path)
    try {
      if (existed) {
        const parsed = JSON.parse(readFileSync(this.path, 'utf8'))
        if (Array.isArray(parsed)) {
          for (const id of parsed) {
            if (typeof id === 'string') {
              this.ids.add(id)
              // Loaded from disk → already durable; do not re-persist these on the next mark().
              this.persisted.add(id)
            }
          }
        }
      }
    } catch {
      // A ledger that EXISTS but cannot be read is a privacy hazard, not a benign empty start:
      // its ids (the sessions to keep NOT recording) are now unknown, so a restart would re-adopt
      // them as normal terminals and begin recording. Fail LOUD, and preserve the unreadable file
      // (see persist()) so it is not silently clobbered and can be recovered. An ABSENT file is the
      // genuine first-run case and stays silent.
      this.loadFailed = true
      console.error(
        `[history] incognito ledger at ${this.path} exists but is unreadable — previously-private sessions may start recording after a restart`
      )
    }
  }

  has(sessionId: string): boolean {
    return this.ids.has(sessionId)
  }

  /**
   * Record an incognito session id and report whether it is now DURABLE on disk.
   *
   * The durable ledger is the ONLY thing that keeps a session incognito across a daemon/app
   * restart: a restart re-adopts or revives the still-live shell under the same id on a fresh
   * HistoryManager, and if that id is not in the ledger a normal writer is created and the shell's
   * new output lands in output.log. A silently-swallowed write therefore defeats the whole feature,
   * so callers must act on a `false` return (the caller surfaces it via the write-error path) rather
   * than assume suppression survived. Retries on every call for an id not yet proven on disk.
   */
  mark(sessionId: string): boolean {
    this.ids.add(sessionId)
    if (this.persisted.has(sessionId)) {
      return true
    }
    return this.persist()
  }

  forget(sessionId: string): void {
    const removed = this.ids.delete(sessionId)
    this.persisted.delete(sessionId)
    if (removed) {
      this.persist()
    }
  }

  private persist(): boolean {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      // Preserve a ledger we failed to read before the first overwrite clobbers it: its ids may be
      // recoverable, and destroying the only copy would turn a readable-later file into a lost one.
      if (this.loadFailed) {
        try {
          renameSync(this.path, `${this.path}.unreadable-${Date.now()}`)
        } catch {
          // Already gone / un-renamable; nothing to preserve.
        }
        this.loadFailed = false
      }
      // Why tmp+rename: a torn write must not corrupt the ledger; a stale-but-whole one is recoverable.
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify([...this.ids]), { mode: 0o600 })
      renameSync(tmp, this.path)
      // The whole set is now on disk; re-sync the durable mirror.
      this.persisted.clear()
      for (const id of this.ids) {
        this.persisted.add(id)
      }
      return true
    } catch {
      // Durability failed. In-memory gating still holds for THIS process, but a restart would not be
      // suppressed. Fail LOUD here — the single persist chokepoint — so the loss is surfaced even
      // when the HistoryManager was built with no onWriteError (production constructs it bare); the
      // caller is told via the `false` return rather than left assuming the write succeeded.
      console.error(
        `[history] incognito ledger at ${this.path} could NOT be persisted — a daemon/app restart may re-adopt these private sessions and start recording them`
      )
      return false
    }
  }
}

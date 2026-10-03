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
  /** A ledger file EXISTED but could not supply a valid id list, so `has()` is no longer authoritative
   *  (the do-not-record ids are lost). Stays true for this process's life so re-adopts fail closed. */
  private untrusted = false
  /** The one-time preserve-rename of an untrusted file has run (so persist() does not rename repeatedly). */
  private preservedCorrupt = false

  constructor(basePath: string) {
    this.path = join(basePath, LEDGER_FILE)
    if (!existsSync(this.path)) {
      return // ABSENT file = genuine first run; stay empty and silent.
    }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'))
      if (!Array.isArray(parsed)) {
        throw new Error('ledger is not a JSON array of ids')
      }
      for (const id of parsed) {
        if (typeof id === 'string') {
          this.ids.add(id)
          // Loaded from disk → already durable; do not re-persist these on the next mark().
          this.persisted.add(id)
        }
      }
    } catch {
      // A ledger that EXISTS but is unreadable OR not a valid id array is a privacy hazard, not a
      // benign empty start: the ids of the sessions to keep NOT recording are now unknown, so a
      // re-adopted terminal would be treated as normal and recorded. Mark the ledger untrusted so
      // every re-adopt fails CLOSED (see HistoryManager), fail LOUD, and preserve the file
      // (see persist()) so it is not clobbered and can be recovered.
      this.untrusted = true
      console.error(
        `[history] incognito ledger at ${this.path} exists but is unreadable/invalid — its private-session ids are lost; re-adopted terminals will NOT be recorded until a clean restart`
      )
    }
  }

  has(sessionId: string): boolean {
    return this.ids.has(sessionId)
  }

  /** The on-disk ledger existed but could not supply trustworthy ids. While true, callers must fail
   *  CLOSED: treat a re-adopted session (no explicit non-incognito flag) as do-not-record, because it
   *  may be one of the lost incognito ids. A fresh, explicitly non-incognito session is unaffected. */
  isUntrusted(): boolean {
    return this.untrusted
  }

  /**
   * Whether a terminal's scrollback must NOT be captured: it is genuinely incognito (explicit flag or
   * a ledger id), OR the ledger is untrusted and this is not an explicitly non-incognito session (a
   * re-adopt whose provenance we can no longer prove — fail closed). `explicit` is the caller's
   * incognito flag, `undefined` on a re-adopt. This decides suppression only; the caller marks a
   * genuine incognito id durably (an untrusted-only re-adopt is suppressed without being marked).
   */
  suppressesCapture(sessionId: string, explicit?: boolean): boolean {
    return explicit === true || this.has(sessionId) || (explicit !== false && this.untrusted)
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
      // Preserve an untrusted ledger before the first overwrite clobbers it: its ids may be
      // recoverable, and destroying the only copy would turn a readable-later file into a lost one.
      // `untrusted` itself stays set (re-adopts keep failing closed until a clean restart); this only
      // guards the rename so it runs once.
      if (this.untrusted && !this.preservedCorrupt) {
        this.preservedCorrupt = true
        try {
          renameSync(this.path, `${this.path}.unreadable-${Date.now()}`)
        } catch {
          // Already gone / un-renamable; nothing to preserve.
        }
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

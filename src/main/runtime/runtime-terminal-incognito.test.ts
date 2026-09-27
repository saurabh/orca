import { describe, expect, it } from 'vitest'
import { resolveTerminalIncognito } from './runtime-terminal-incognito'
import type { GlobalSettings } from '../../shared/global-settings-types'

function settings(
  agents: GlobalSettings['terminalIncognitoAgents']
): Pick<GlobalSettings, 'terminalIncognitoAgents'> {
  return { terminalIncognitoAgents: agents }
}

describe('resolveTerminalIncognito', () => {
  it('honors an explicit per-terminal true', () => {
    expect(resolveTerminalIncognito({ incognito: true }, {}, () => settings([]))).toBe(true)
  })

  it('honors an explicit per-terminal false even when the agent is a default', () => {
    expect(
      resolveTerminalIncognito(
        { incognito: false, launchAgent: 'claude' },
        { launchAgent: 'claude' },
        () => settings(['claude'])
      )
    ).toBe(false)
  })

  it('applies the per-agent default when the flag is unspecified', () => {
    expect(
      resolveTerminalIncognito({ launchAgent: 'claude' }, { launchAgent: 'claude' }, () =>
        settings(['claude'])
      )
    ).toBe(true)
  })

  it('matches the resolved launch agent even when only startupAgent was requested', () => {
    expect(
      resolveTerminalIncognito({ startupAgent: 'codex' }, { launchAgent: 'codex' }, () =>
        settings(['codex'])
      )
    ).toBe(true)
  })

  it('is false for an agent not in the default list', () => {
    expect(
      resolveTerminalIncognito({ launchAgent: 'codex' }, { launchAgent: 'codex' }, () =>
        settings(['claude'])
      )
    ).toBe(false)
  })

  it('is false when there is no agent and no explicit flag', () => {
    expect(resolveTerminalIncognito({}, {}, () => settings(['claude']))).toBe(false)
  })

  it('is false when settings are unavailable', () => {
    expect(
      resolveTerminalIncognito({ launchAgent: 'claude' }, { launchAgent: 'claude' }, () => undefined)
    ).toBe(false)
  })
})

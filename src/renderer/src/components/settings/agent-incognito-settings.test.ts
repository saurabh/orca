import { describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  buildAgentIncognitoSettingsUpdate,
  createAgentIncognitoUpdateQueue
} from './agent-incognito-settings'

describe('agent incognito settings', () => {
  it('adds an agent to the incognito list, normalizing duplicates and unknown ids', () => {
    expect(
      buildAgentIncognitoSettingsUpdate(
        { terminalIncognitoAgents: ['claude', 'claude', 'unknown-agent'] as never[] },
        'codex',
        true
      )
    ).toEqual({
      terminalIncognitoAgents: ['claude', 'codex']
    })
  })

  it('removes an agent from the incognito list when toggled off', () => {
    expect(
      buildAgentIncognitoSettingsUpdate(
        { terminalIncognitoAgents: ['claude', 'codex'] },
        'claude',
        false
      )
    ).toEqual({
      terminalIncognitoAgents: ['codex']
    })
  })

  it('is idempotent when enabling an already-incognito agent', () => {
    expect(
      buildAgentIncognitoSettingsUpdate({ terminalIncognitoAgents: ['claude'] }, 'claude', true)
    ).toEqual({
      terminalIncognitoAgents: ['claude']
    })
  })

  it('continues serializing requests after a rejected write', async () => {
    const settings: GlobalSettings = {
      ...getDefaultSettings('/tmp'),
      terminalIncognitoAgents: []
    }
    let latest = settings
    const updateSettings = vi
      .fn<(update: Partial<GlobalSettings>) => Promise<void>>()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockImplementationOnce(async (update) => {
        latest = { ...latest, ...update }
      })
    const enqueue = createAgentIncognitoUpdateQueue()

    await expect(
      enqueue({
        getSettings: () => latest,
        fallbackSettings: settings,
        updateSettings,
        agentId: 'claude',
        incognito: true
      })
    ).rejects.toThrow('write failed')
    await enqueue({
      getSettings: () => latest,
      fallbackSettings: settings,
      updateSettings,
      agentId: 'codex',
      incognito: true
    })

    expect(updateSettings).toHaveBeenCalledTimes(2)
    expect(updateSettings.mock.calls[1][0]).toMatchObject({ terminalIncognitoAgents: ['codex'] })
  })
})

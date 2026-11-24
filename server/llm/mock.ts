import type { AdapterFactory } from './types'

/**
 * SALES_PULSE_LLM_MOCK=1: deterministic stand-in for E2E tests and demos without an API key.
 * Mapping: an empty proposal, so merging it over the heuristic mapping yields the heuristic mapping.
 * Summary: the template the caller supplies (a known-valid one), so the full validate/render path still runs.
 */
export const mockAdapterFactory: AdapterFactory = (_config, task) => ({
  async complete() {
    switch (task.kind) {
      case 'test':
        return '{"ok":true}'
      case 'mapping':
        return JSON.stringify({ notes: ['Mock LLM: heuristic mapping returned unchanged.'] })
      case 'summary':
        return JSON.stringify({ template: task.template() })
    }
  },
})

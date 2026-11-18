import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'mission-control', component: 'Pane', requestId: 'mission-control',
  props: { title: 'Mission control', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

test('the pane draws with a running agent', async ($, on) => {
  on('command.register', () => ({ value: {} }))
  on('state.get', (_: any, e: any, next: any) =>
    e.key === 'agents'
      ? { value: { value: [{ id: 'a1', what: 'Example task', type: 'general-purpose', model: 'Opus', status: 'running', start: Date.now() - 5000, tokens: 0 }], version: 1 } }
      : e.key === 'current' ? { value: { value: 'claude-sonnet-5-5', version: 1 } } : next(e))
  on('agent.list', () => ({ value: [] }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const t = await ui.find({ type: 'Text', text: /RUNNING|Running/ })
    expect(t).toBeTruthy()
    await ui.unmount()
  }
})

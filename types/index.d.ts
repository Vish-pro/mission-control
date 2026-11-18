export type ModelStat = { turns: number; input: number; output: number; cached: number }
export type Handoff = { at: string; agent: string; model: string; what: string }
export type AgentRow = {
  id: string
  what: string
  type: string
  model: string
  status: string
  start: number
  end?: number
  tokens: number
  ctx?: number
  cost?: number
}

declare module 'claude-code' {
  interface PluginState {
    'mission-control': {
      models: Record<string, ModelStat>
      handoffs: Handoff[]
      current: string
      agents: AgentRow[]
      tick: number
    }
  }
}

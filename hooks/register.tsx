import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentRow, Handoff, ModelStat } from '../types'
import { crab, CRAB_CSS } from './crabs'

// One band above the prompt and one pane: the model working now, the helper
// agents (live, animated), tokens by model and recent hand-offs.
const PANE = 'mission-control'
const TITLE = 'Mission control'
const models = atom({ plugin: 'mission-control', key: 'models' } as const, {} as Record<string, ModelStat>)
const handoffs = atom({ plugin: 'mission-control', key: 'handoffs' } as const, [] as Handoff[])
const current = atom({ plugin: 'mission-control', key: 'current' } as const, '')
const agents = atom({ plugin: 'mission-control', key: 'agents' } as const, [] as AgentRow[])
const tick = atom({ plugin: 'mission-control', key: 'tick' } as const, 0)

const AGENT_MODEL: Record<string, string> = { quick: 'haiku', builder: 'sonnet', planner: 'opus', 'bug-hunter': 'opus' }
const COLOR: Record<string, string> = { Opus: '#C26BE0', Sonnet: '#3BA7D9', Haiku: '#3FB97A', Fable: '#E0A93B' }
const GREY = '#8a8a86'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
const ACTIVE = ['pending', 'running', 'waiting', 'idle']
// USD per million tokens (input, output, cache read, cache write): an estimate, as savvy's.
const PRICES: [RegExp, number[]][] = [
  [/fable|mythos/, [10, 50, 1, 20]], [/opus-5-5/, [4, 20, 0.2, 8]], [/opus/, [5, 25, 0.5, 10]],
  [/sonnet-5-5/, [2, 10, 0.1, 4]], [/sonnet/, [3, 15, 0.3, 6]], [/haiku-5-5/, [0.1, 0.5, 0.01, 0.2]], [/haiku/, [1, 5, 0.1, 2]],
]
const costOf = (model: string, u: any): number => {
  const [i, o, r, w] = PRICES.find(([re]) => re.test(model.toLowerCase()))?.[1] ?? [4, 20, 0.2, 8]
  return ((u.input_tokens || 0) * i! + (u.output_tokens || 0) * o! + (u.cache_read_input_tokens || 0) * r! + (u.cache_creation_input_tokens || 0) * w!) / 1e6
}
const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`
// Which crab costume each helper wears.
const COSTUME: Record<string, string> = { quick: 'light', builder: 'careful', planner: 'fable', 'bug-hunter': 'heavy', Explore: 'explore', Plan: 'fable', 'general-purpose': 'medium' }
const costumeOf = (type: string): string => COSTUME[type] ?? COSTUME[type.replace(/^[^:]*:/, '')] ?? 'other'

const short = (id: string | undefined): string => {
  const m = /(opus|sonnet|haiku|fable)/i.exec(id ?? '')
  return m ? m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase() : id || '?'
}
const col = (m: string): string => COLOR[m] ?? GREY
const k = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const dur = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}
const one = (t: string): string => t.replace(/\s+/g, ' ').trim()
const trunc = (t: string, n: number): string => {
  const s = one(t)
  return s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s
}
const xml = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const clock = (): string => new Date().toTimeString().slice(0, 5)
const bucket = (s: string): 'running' | 'failed' | 'done' =>
  ACTIVE.includes(s) ? 'running' : s === 'failed' || s === 'killed' ? 'failed' : 'done'

type View = AgentRow & { label: string }

// Stored rows, with the engine's live status and latest progress line laid over.
async function rowsOf($: any): Promise<View[]> {
  const stored = await read($, agents)
  const live: Record<string, { status: string; label: string }> = {}
  try {
    for (const a of await $.agent.list()) live[a.id] = { status: a.status, label: a.label ?? '' }
  } catch {
    // no live list: stored statuses stand
  }
  return stored.map(a => ({ ...a, status: live[a.id]?.status ?? a.status, label: live[a.id]?.label ?? '' }))
}

// --- drawings (desktop). Periods divide one second, so the 1 s redraw of a
// running view restarts every animation in phase.
const CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#5f5f5b}.m{fill:#9a9a96}.k{fill:#ecebe8}.card{fill:#f6f5f2;stroke:#e4e3df}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#c4c4c0}.m{fill:#a0a09c}.k{fill:#2a2a29}.card{fill:#1f1f1e;stroke:#323230}}
.pulse{animation:pu 1s ease-in-out infinite}@keyframes pu{50%{opacity:.25}}
.halo{animation:ha 1s ease-out infinite;transform-box:fill-box;transform-origin:center}@keyframes ha{0%{transform:scale(.6);opacity:.7}100%{transform:scale(1.6);opacity:0}}
.spin{animation:sp 1s linear infinite;transform-box:fill-box;transform-origin:center}@keyframes sp{to{transform:rotate(360deg)}}
.sweep{animation:sw 1s ease-in-out infinite}@keyframes sw{0%{transform:translateX(-40%)}100%{transform:translateX(140%)}}
.bob{animation:bo .5s steps(1) infinite}@keyframes bo{50%{transform:translateY(-1px)}}
@media (prefers-reduced-motion: reduce){.pulse,.halo,.spin,.sweep,.bob{animation:none}}
</style>`

// The band: a breathing orb for the model answering now, then one chip per running agent.
const bandSvg = (W: number, now: string, run: View[], at: number): string => {
  const H = 30
  const m = short(now)
  const c = col(m)
  const chips: string[] = []
  let x = 120
  for (const a of run) {
    const label = `${a.model} · ${trunc(a.what, 22)} · ${dur(at - a.start)}`
    const w = Math.round(26 + label.length * 6.1)
    if (x + w > W - 4) {
      chips.push(`<text class="m" x="${x + 4}" y="19" font-family="${FONT}" font-size="11.5">+${run.length - chips.length} more</text>`)
      break
    }
    const ac = col(a.model)
    chips.push(`<g transform="translate(${x},4)">
<rect width="${w}" height="22" rx="11" fill="${ac}" opacity=".14"/>
<rect width="${w}" height="22" rx="11" fill="none" stroke="${ac}" stroke-opacity=".5"/>
<g clip-path="url(#chip${chips.length})"><rect class="sweep" x="0" y="0" width="${Math.round(w * 0.35)}" height="22" fill="${ac}" opacity=".18"/></g>
<clipPath id="chip${chips.length}"><rect width="${w}" height="22" rx="11"/></clipPath>
<circle cx="12" cy="11" r="4" fill="${ac}"/><circle class="halo" cx="12" cy="11" r="4" fill="${ac}"/>
<text class="t" x="21" y="15" font-family="${FONT}" font-size="11.5">${xml(label)}</text></g>`)
    x += w + 6
  }
  const idle = run.length === 0
    ? `<text class="m" x="120" y="19" font-family="${FONT}" font-size="11.5">no helper agents running</text>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${CSS}
<circle cx="13" cy="15" r="6" fill="${c}"${idle ? '' : ' class="pulse"'}/>
<circle class="halo" cx="13" cy="15" r="6" fill="${c}"/>
<text class="m" x="26" y="12" font-family="${FONT}" font-size="9" letter-spacing="1">WORKING</text>
<text x="26" y="25" font-family="${FONT}" font-size="13" font-weight="600" fill="${c}">${xml(m)}</text>
<rect x="110" y="6" width="1" height="18" class="k"/>
${idle}${chips.join('')}
</svg>`
}

// The pane's header: an orbit of the agents around the model answering now.
const headerSvg = (W: number, now: string, rows: View[], totalTok: number): string => {
  const H = 96
  const m = short(now)
  const c = col(m)
  const run = rows.filter(a => bucket(a.status) === 'running')
  const sats = run
    .map((a, i) => {
      const ang = (i / Math.max(1, run.length)) * Math.PI * 2
      return `<circle cx="${48 + Math.cos(ang) * 34}" cy="${48 + Math.sin(ang) * 34}" r="5" fill="${col(a.model)}"/>`
    })
    .join('')
  const done = rows.filter(a => bucket(a.status) === 'done').length
  const failed = rows.filter(a => bucket(a.status) === 'failed').length
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${CSS}
<circle cx="48" cy="48" r="34" fill="none" class="k" stroke="currentColor" stroke-opacity=".15" stroke-dasharray="3 5"/>
<g class="${run.length ? 'spin' : ''}"><circle cx="48" cy="48" r="34" fill="none" stroke="none"/>${sats}</g>
<circle class="halo" cx="48" cy="48" r="16" fill="${c}"/>
<circle cx="48" cy="48" r="16" fill="${c}"/>
<text x="48" y="52" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" fill="#fff">${xml(m.slice(0, 1))}</text>
<text class="m" x="98" y="30" font-family="${FONT}" font-size="9.5" letter-spacing="1.2">NOW WORKING</text>
<text x="98" y="50" font-family="${FONT}" font-size="20" font-weight="600" fill="${c}">${xml(m)}</text>
<text class="s" x="98" y="70" font-family="${FONT}" font-size="11.5">${run.length} running · ${done} done · ${failed} failed · ${k(totalTok)} agent tokens</text>
<text class="m" x="98" y="86" font-family="${FONT}" font-size="10">live · updated ${clock()}</text>
</svg>`
}

// One agent card: avatar ring that spins while it runs, title, facts, latest line and a sweep bar.
const cardSvg = (W: number, a: View, at: number): string => {
  const H = 70
  const b = bucket(a.status)
  const c = col(a.model)
  const running = b === 'running'
  const chars = Math.max(10, Math.floor((W - 70) / 6.6))
  const barW = W - 66
  const ctxPct = a.ctx ? Math.min(100, Math.round((a.ctx / 1_000_000) * 100)) : 0
  const stats = `ctx ${ctxPct}% · ${k(a.ctx ?? 0)}  ≈${fmtCost(a.cost ?? 0)}  ${dur((running ? at : a.end ?? at) - a.start)}`
  const mark = running
    ? `<circle class="pulse" cx="${W - 10}" cy="14" r="3.5" fill="${c}"/>`
    : b === 'done'
      ? `<path d="M${W - 15} 14l3.5 3.5 6.5-7" fill="none" stroke="#3B9C5F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<path d="M${W - 14} 10l8 8M${W - 6} 10l-8 8" stroke="#D0453F" stroke-width="1.8" stroke-linecap="round"/>`
  const cid = `bc${a.id.replace(/[^a-z0-9]/gi, '').slice(-8)}`
  const bar = running
    ? `<rect x="54" y="58" width="${barW}" height="4" rx="2" class="k"/><clipPath id="${cid}"><rect x="54" y="58" width="${barW}" height="4" rx="2"/></clipPath><g clip-path="url(#${cid})"><rect class="sweep" x="54" y="58" width="${Math.round(barW * 0.4)}" height="4" rx="2" fill="${c}"/></g>`
    : `<rect x="54" y="58" width="${barW}" height="4" rx="2" fill="${b === 'failed' ? '#D0453F' : c}" opacity=".45"/>`
  const line = a.label && one(a.label) !== one(a.what) ? a.label : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${CSS}${CRAB_CSS}
<rect x="1" y="1" width="${W - 2}" height="${H - 4}" rx="10" class="card"/>
<rect x="1" y="8" width="3" height="${H - 18}" rx="1.5" fill="${c}"/>
${crab(9, 16, costumeOf(a.type), b === 'failed', running, 1.1)}
<text class="t" x="54" y="18" font-family="${FONT}" font-size="12.5" font-weight="600">${xml(trunc(a.what, chars - 2))}</text>
<text x="54" y="33" font-family="${FONT}" font-size="10.5"><tspan fill="${c}" font-weight="600">${xml(a.model)}</tspan><tspan class="s">  ·  ${xml(a.type)}  ·  ${xml(a.status)}</tspan></text>
<text class="m" x="54" y="49" font-family="${FONT}" font-size="10" font-style="italic">${xml(trunc(line, Math.max(6, chars - 28)))}</text>
<text class="s" x="${W - 12}" y="49" text-anchor="end" font-family="${FONT}" font-size="10.5" font-variant-numeric="tabular-nums">${xml(stats)}</text>
${bar}
${mark}
</svg>`
}

// Tokens by model: one bar per model (fresh input + output; cached is text, it would dwarf the bar).
const tokensSvg = (W: number, stats: Record<string, ModelStat>): string => {
  const ids = Object.keys(stats)
  const H = 40 + ids.length * 66
  const max = Math.max(1, ...ids.map(id => stats[id]!.input + stats[id]!.output))
  const rows = ids
    .map((id, i) => {
      const s = stats[id]!
      const m = short(id)
      const c = col(m)
      const y = 38 + i * 66
      const w1 = Math.max(3, (s.input / max) * W)
      const w2 = (s.output / max) * W
      return `<text class="t" x="0" y="${y + 12}" font-family="${FONT}" font-size="14" font-weight="700" fill="${c}">${xml(m)}</text>
<text class="s" x="${W}" y="${y + 12}" text-anchor="end" font-family="${FONT}" font-size="11.5">${s.turns} turn${s.turns === 1 ? '' : 's'}</text>
<rect x="0" y="${y + 20}" width="${W}" height="14" rx="7" class="k"/>
<rect x="0" y="${y + 20}" width="${Math.min(W, w1 + w2)}" height="14" rx="7" fill="${c}" opacity=".45"/>
<rect x="0" y="${y + 20}" width="${w1}" height="14" rx="7" fill="${c}"/>
<text class="t" x="0" y="${y + 52}" font-family="${FONT}" font-size="12" font-variant-numeric="tabular-nums"><tspan fill="${c}" font-weight="700">in</tspan> ${k(s.input)}   <tspan fill="${c}" font-weight="700">out</tspan> ${k(s.output)}</text>
<text class="s" x="${W}" y="${y + 52}" text-anchor="end" font-family="${FONT}" font-size="12" font-variant-numeric="tabular-nums">cached ${k(s.cached)}</text>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${CSS}
<text class="s" x="0" y="13" font-family="${FONT}" font-size="11" font-weight="700" letter-spacing="1.4">TOKENS BY MODEL</text>
<text class="s" x="0" y="28" font-family="${FONT}" font-size="10.5">bar: solid = in, light = out</text>
${rows}
</svg>`
}

// The model as /model shows it (follows a switch at once); the last answered turn is the fallback.
const nowModel = async ($: any): Promise<string> => {
  try {
    const m = await $.session.model()
    if (m) return short(m)
  } catch {
    // fall back below
  }
  return read($, current)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [name, description] of [
      ['control', 'Open Mission control: model working now, live agents, tokens and hand-offs'],
      ['models', 'Open Mission control (models and tokens)'],
      ['agentinfo', 'Open Mission control (helper agents of this chat)'],
      ['live', 'Open Mission control (live status)'],
    ] as const) {
      await $.command.register({ name, description })
    }
    // 1 s while an agent runs (clocks tick, animations stay in phase), 15 s otherwise.
    let quiet = 0
    $.clock.every(1000, async () => {
      try {
        const run = (await read($, agents)).some(a => bucket(a.status) === 'running')
        quiet = run ? 0 : quiet + 1
        if (run || quiet >= 15) {
          quiet = 0
          await update($, tick, n => n + 1)
        }
      } catch {
        // a missed refresh is harmless
      }
    })
    return next(e)
  })

  for (const name of ['control', 'models', 'agentinfo', 'live']) {
    on('command.run', { command: name }, async $ => {
      await $.ui.open({ id: PANE, title: TITLE })
      return { text: 'Mission control opened.' }
    })
  }

  on('agent.spawn', async ($, e, next) => {
    const model = e.model ?? AGENT_MODEL[e.subagentType] ?? 'agent default'
    try {
      const what = one(e.description).slice(0, 60)
      await update($, handoffs, list => [...list, { at: clock(), agent: e.subagentType, model: short(model), what }].slice(-10))
      await $.ui.toast(`${short(model)} took over: ${what}`)
    } catch {
      // never block a hand-off
    }
    const res = await next(e)
    try {
      if (res && !res.deny && res.agentId) {
        const id = res.agentId
        const m = short(res.model || model)
        await update($, agents, list =>
          [...list.filter(a => a.id !== id), { id, what: e.description, type: e.subagentType, model: m, status: 'running', start: Date.now(), tokens: 0 }].slice(-50),
        )
      }
    } catch {
      // never block
    }
    return res
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    const aid = e.agentId
    if (aid) {
      try {
        const add = u ? u.input_tokens + u.cache_creation_input_tokens + u.output_tokens : 0
        await update($, agents, list =>
          list.map(a => (a.id === aid ? { ...a, tokens: a.tokens + add, ctx: u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : a.ctx, cost: (a.cost ?? 0) + (u ? costOf(u.model, u) : 0), end: Date.now(), status: e.reason === 'answer' ? 'completed' : 'failed' } : a)),
        )
      } catch {
        // never block
      }
    }
    if (u) {
      await update($, models, all => {
        const old = all[u.model] ?? { turns: 0, input: 0, output: 0, cached: 0 }
        return {
          ...all,
          [u.model]: {
            turns: old.turns + 1,
            input: old.input + u.input_tokens + u.cache_creation_input_tokens,
            output: old.output + u.output_tokens,
            cached: old.cached + u.cache_read_input_tokens,
          },
        }
      })
      if (!aid) {
        await update($, current, () => u.model)
        await $.ui.status(`⚡ ${short(u.model)}`)
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await read($, tick)
    const now = await nowModel($)
    const rows = await rowsOf($)
    const run = rows.filter(a => bucket(a.status) === 'running')
    if (e.props.hasSurvey || (!now && run.length === 0)) return next(e)

    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const open = <Button key="mc-open" label={run.length ? `◉ Control · ${run.length}` : '◉ Control'} onPress={() => void $.ui.open({ id: PANE, title: TITLE })} />
    const at = Date.now()

    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui as any
      const W = Math.max(200, Math.min(1600, (e.props.bodyColumns || 100) * 8 - 260))
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" gap={1}>
            {open}
            <Svg source={bandSvg(W, now, run, at)} alt={`Working: ${short(now)}, ${run.length} agents running`} width={W} height={30} />
          </Box>
          {below}
        </Box>
      )
    }
    const first = run[0]
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color="cyan">◉</Text>
          <Text>Working: {short(now)}</Text>
          {first && (
            <Text dimColor>
              · {first.model} {trunc(first.what, 30)} {dur(at - first.start)}
              {run.length > 1 ? ` +${run.length - 1}` : ''}
            </Text>
          )}
          {open}
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, tick)
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const stats = await read($, models)
    const hops = await read($, handoffs)
    const now = await nowModel($)
    const rows = await rowsOf($)
    const at = Date.now()
    const run = rows.filter(a => bucket(a.status) === 'running').sort((a, b) => a.start - b.start)
    const rest = rows.filter(a => bucket(a.status) !== 'running').reverse().slice(0, 12)
    const totalTok = rows.reduce((t, a) => t + a.tokens, 0)

    if (e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg } = ui as any
      const W = Math.max(240, Math.min(900, ((e.props as any).bodyColumns || 40) * 8 - 8))
      return (
        <Box flexDirection="column" gap={1}>
          <Svg key="head" source={headerSvg(W, now, rows, totalTok)} alt={`Now working ${short(now)}`} width={W} height={96} />
          <Text dimColor>RUNNING · {run.length}</Text>
          {run.length === 0 && <Text dimColor>No helper agents running.</Text>}
          {run.map(a => (
            <Svg key={`r-${a.id}`} source={cardSvg(W, a, at)} alt={`${a.what}: ${a.model}, running`} width={W} height={70} />
          ))}
          {rest.length > 0 && <Text dimColor>FINISHED · {rest.length}</Text>}
          {rest.map(a => (
            <Svg key={`d-${a.id}`} source={cardSvg(W, a, at)} alt={`${a.what}: ${a.model}, ${a.status}`} width={W} height={70} />
          ))}
          {Object.keys(stats).length > 0 && (
            <Svg key="tok" source={tokensSvg(W, stats)} alt="Tokens by model" width={W} height={40 + Object.keys(stats).length * 66} />
          )}
          <Text dimColor>RECENT HAND-OFFS</Text>
          {hops.length === 0 && <Text dimColor>None yet.</Text>}
          {hops
            .slice()
            .reverse()
            .map((hop, i) => (
              <Text>
                <Text dimColor>{hop.at} </Text>
                <Text color={col(hop.model)}>{hop.model}</Text>
                <Text> via {hop.agent}: {hop.what}</Text>
              </Text>
            ))}
          <Text dimColor>Plan limits: /usage in the app.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>Now working: {short(now) || 'waiting'}</Text>
        <Text dimColor>
          {run.length} running · {rows.length - run.length} finished · {k(totalTok)} agent tokens · {clock()}
        </Text>
        <Text> </Text>
        <Text bold>Running ({run.length})</Text>
        {run.length === 0 && <Text dimColor>No helper agents running.</Text>}
        {run.map(a => (
          <Text>
            ◐ {a.model} · {trunc(a.what, 40)} · {dur(at - a.start)}
          </Text>
        ))}
        {rest.length > 0 && <Text bold>Finished</Text>}
        {rest.map(a => (
          <Text dimColor>
            {bucket(a.status) === 'done' ? '✓' : '✕'} {a.model} · {trunc(a.what, 40)} · {k(a.tokens)} tok
          </Text>
        ))}
        <Text> </Text>
        <Text bold>Tokens by model</Text>
        {Object.keys(stats).map(id => (
          <Text>
            {short(id)}: {stats[id]!.turns} turns, {k(stats[id]!.input)} in, {k(stats[id]!.output)} out, {k(stats[id]!.cached)} cached
          </Text>
        ))}
        <Text> </Text>
        <Text bold>Recent hand-offs</Text>
        {hops
          .slice()
          .reverse()
          .map(hop => (
            <Text>
              {hop.at} {hop.model} via {hop.agent}: {hop.what}
            </Text>
          ))}
      </Box>
    )
  })
}

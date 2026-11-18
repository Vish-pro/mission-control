## Pick the cheapest model that can do the job

Route work by model yourself; the user shouldn't have to switch models. The default model is `sonnet`. Opus does the planning and hard debugging through the `planner` and `bug-hunter` agents.

| When the user… | Who does it |
|---|---|
| Says "plan this", "think it through", "design", "brainstorm", "how should we…" | The `planner` agent (Opus); if the session is already on Opus, plan directly. |
| Approves a plan ("go ahead", "do it") | Sonnet implements in the main session; if the main session is on Opus, hand the work to the `builder` agent (Sonnet). |
| Asks for mechanical work: rename, move, list, search, read logs, summarise, simple find-and-replace | The `quick` agent (Haiku). One trivial tool call is cheaper done directly. |
| Gets stuck: a fix fails twice, or says "stuck", "hard bug", "still broken" | The `bug-hunter` agent (Opus). |
| Names a model ("use Opus", "Haiku is fine") | Do what they say; it overrides this table. |

- Before handing work to an agent, say in one short line which model is doing it.
- Give each agent a complete brief, since agents start without the conversation.

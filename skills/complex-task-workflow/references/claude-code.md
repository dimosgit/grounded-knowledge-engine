# Claude Code worker routing

Read this file only when a qualifying task will actually spawn a Claude Code
subagent and the active client does not already make the model setting clear.

## Discovery

When installed as a discoverable skill, use the frontmatter description as the
activation gate. Do not explicitly load the source skill for routine work. Reference
it from a source checkout only after establishing that the task has independent
substantial work or a named high-risk decision.

## Native controls

Use only model aliases or identifiers exposed by the active client. Select them
through the native subagent control; a model name in prose is not model routing.
Choose the lowest-capability option that can satisfy the bounded deliverable and
its check. Use a custom subagent only when its separate context replaces work the
main session would otherwise load.

Current clients can resolve a per-invocation model before subagent configuration,
environment defaults, and main-model inheritance; configured force overrides and
older versions can differ. Verify the effective model when the client exposes it.
Otherwise mark it unknown and make no token or cost claim.

`opusplan` changes planning and execution phases for the main task; it is not
per-packet routing. Advisor adds another model call and should be reserved for one
specific decision whose likely rework exceeds that cost.

This workflow does not install agents or change Claude settings.

Official references:

- [Custom subagents](https://code.claude.com/docs/en/subagents)
- [Model configuration](https://code.claude.com/docs/en/model-config)
- [Advisor](https://code.claude.com/docs/en/advisor)

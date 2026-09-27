# Codex worker routing

Read this file only when a qualifying task will actually spawn a Codex worker and
the active tool schema does not already answer the model-setting question.

## Discovery

The repository `.agents/skills` link makes the source skill discoverable in Codex.
The frontmatter description is the activation gate. Do not explicitly load it for
routine work.

## Native controls

Use the model identifiers and reasoning values listed by the active spawn tool.
Pass them through the native model/reasoning arguments; mentioning a model in the
worker prompt does not select it. Unspecified settings may inherit from the parent
or configured defaults, so report only effective values the runtime exposes.

Choose the lowest-capability listed model that can satisfy the packet and its check.
Use low reasoning for mechanical discovery or a tightly specified edit. Preserve
the coordinator for integration. Do not create a worker solely to change models
when its fresh-session context is likely to exceed the context it avoids.

Explicit custom-agent settings can override spawn requests. Without such settings,
Codex resolves explicit spawn values before agent defaults and parent inheritance.
Verify when the client exposes the result; otherwise mark it unknown and make no
token or cost claim.

The active tool schema is the authority for availability. Configuration changes
and user-level skill installation stay outside this workflow unless requested.

Official references:

- [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Build Codex skills](https://learn.chatgpt.com/docs/build-skills)

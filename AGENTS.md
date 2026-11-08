# General Programming Principles

These principles are intentionally independent of any language, framework, or version. They are meant to remain useful over time; they do not replace task requirements or more specific repository conventions and instructions. In case of conflict, follow the most specific applicable requirements.

For Node.js backend work, also read and follow [docs/backend-node.md](docs/backend-node.md).

## Understand Before Changing

- Clarify the expected outcome, constraints, and existing behavior before acting.
- Read nearby code and reuse established mechanisms when appropriate.
- Preserve existing interfaces, data, and behavior unless a change is explicitly requested.
- If an ambiguity could materially affect the outcome or its risk, ask for clarification instead of guessing.

## Design and Write Code

- Prefer the simplest solution that fully satisfies the requirement.
- Write readable code with clear names, coherent responsibilities, and understandable control flow.
- Reduce duplication when genuinely shared logic can be reused; avoid premature abstractions and generalization without a concrete need.
- Follow the project's style and conventions. Do not impose personal preferences when local conventions exist.
- Handle errors explicitly at appropriate boundaries. Do not hide failures behind misleading results, silent defaults, or overly broad error handling.
- Document non-obvious contracts and decisions; comments should explain why, not paraphrase the code.
- Avoid dependencies, changes, and refactoring unrelated to the requirement.

## Security and Data

- Treat external input as untrusted; validate and constrain it at the point where it enters the system.
- Apply least privilege and verify authorization where the resource is actually controlled.
- Do not expose secrets or sensitive data in code, responses, logs, or error messages.
- Choose safe defaults and account for the consequences of errors, retries, or repeated operations.

## Verification and Delivery

- Verify observable behavior, not only internal implementation.
- Cover normal cases, important boundaries, and relevant failures; keep tests reproducible and independent where practical.
- After a change, run the relevant checks already defined by the project and review the diff for regressions and unintended changes.
- Update documentation when behavior, contracts, or usage change.
- Accurately describe what changed, which checks were performed, and any remaining limitations; never claim a check was run if it was not.

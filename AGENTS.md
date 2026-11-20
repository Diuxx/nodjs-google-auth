
# General Programming Principles

Apply these principles to all development tasks, regardless of language, framework, or architecture.

Follow project conventions and the most specific applicable instructions.

## 1. Understand and Preserve

- Inspect relevant code, dependencies, contracts, and conventions before making changes.
- Reuse existing mechanisms and respect the established architecture.
- Preserve existing behavior and compatibility unless explicitly requested otherwise.
- Keep changes focused. Avoid unrelated refactoring or unnecessary dependencies.
- Ask for clarification only when ambiguity materially affects correctness or safety. Otherwise, state reasonable assumptions.

## 2. Write Maintainable Code

Prioritize human readability over cleverness or excessive abstraction.

- Prefer simple, explicit solutions with precise names and clear responsibilities.
- Separate concerns when it improves clarity and maintainability.
- Keep dependencies and side effects visible.
- Extract complex rules, conditions, and processing steps into well-named functions, even when used once.
- Keep functions at a coherent abstraction level without excessive fragmentation.
- Reduce nesting with guard clauses and clear control flow.
- Keep related logic together for easier navigation.
- Favor composition over inheritance when appropriate.
- Apply SOLID, KISS, DRY, and YAGNI pragmatically.
- Introduce abstractions and design patterns only to solve concrete problems.

## 3. Reliability and Security

- Validate inputs and enforce applicable invariants.
- Handle errors explicitly without hiding failures or losing useful context.
- Consider edge cases, invalid states, and partial failures.
- Address concurrency, retries, and idempotency when relevant.
- Treat external input as untrusted.
- Apply least privilege and appropriate access controls.
- Never expose secrets or sensitive information.
- Protect data integrity and avoid unsafe destructive operations.

## 4. Comments and Documentation

- Prefer self-explanatory code over unnecessary comments.
- Explain WHY, not WHAT: document non-obvious decisions, constraints, and trade-offs.
- Document complex public interfaces when their contracts or side effects are unclear.
- Avoid redundant comments and excessive documentation.
- Keep documentation consistent with actual behavior.

## 5. Agent Workflow

1. **Inspect** — Understand the relevant implementation and conventions.
2. **Plan** — Identify the smallest coherent change and its impacts.
3. **Implement** — Write readable code respecting existing patterns.
4. **Verify** — Follow the project's testing and verification instructions.
5. **Simplify** — Remove unnecessary complexity, duplication, and abstractions.
6. **Report** — Summarize changes, decisions, performed checks, and limitations.

Keep planning and reporting proportional to task complexity.

## Core Rule

Deliver the simplest correct, secure, and maintainable solution.

Optimize for human understanding, not code brevity or sophistication.

## Documentation

All project documentation MUST be written in **English**.

The expected project documentation consists of:

- `AGENTS.md` and `README.md` at the project root.
- `docs/PROJECT.md`, `docs/RESUME.md`, and `docs/USAGE.md` in `docs/`.

If a required file is missing, create it and initialize it with verified information
from the project. Do not invent features, commands, or architectural decisions.
If other project Markdown files exist or the layout otherwise differs from this
structure, ask the user whether to update it before reorganizing, merging, moving,
or deleting existing files. Creating a missing required file does not require
permission.

### README.md

Every project must maintain a short, clear, and welcoming `README.md` at its root.

The README is a **project overview, not a technical manual**.

It should include:

1. **Introduction** — Project name, purpose, and a brief description.
2. **Features** — Main capabilities, summarized in a few bullet points.
3. **Quick Start** — Minimal commands to get started, only when relevant.
4. **Documentation** — A link to [`docs/USAGE.md`](docs/USAGE.md).

### docs/USAGE.md

Keep detailed technical documentation in `docs/USAGE.md`, including when applicable:

- Prerequisites and installation.
- Configuration and environment variables.
- Usage examples and integration instructions.
- Development, build, and testing commands.
- Architecture details necessary for users.
- Troubleshooting and known limitations.

### Rules

- Write all documentation in English.
- Keep the README concise and focused on what the project offers.
- Avoid implementation details, architecture breakdowns, and long instructions in the README.
- Do not list internal Markdown files or explain the documentation structure in the README.
- Link to `docs/USAGE.md` for detailed instructions.
- Avoid duplication between README and USAGE.
- Document only implemented features and verified commands.
- Keep documentation synchronized with actual project behavior.
- Use clear headings, simple language, and executable examples.
- When documenting architecture, prefer concise ASCII diagrams in fenced code blocks
  when they make components, structure, or data flows easier to understand.
- Create or update `docs/USAGE.md` when technical instructions change.
- Omit irrelevant sections rather than adding empty placeholders.

## Documentation Policy

Markdown files (`*.md`) are read-only by default.

### Allowed Modifications

The following files may be created or updated without explicit permission:

- `README.md` — Keep the project description, technologies, setup, execution, and testing commands accurate.
- `docs/RESUME.md` — Maintain a concise technical summary of the project's architecture for future development sessions.
- `docs/USAGE.md` — Maintain detailed, verified usage and development instructions.

Create `AGENTS.md` or `docs/PROJECT.md` when missing, based on verified project
information. Once they exist, treat them as read-only unless the user explicitly
requests changes.

### Architecture Summary

As the project evolves, maintain a concise summary containing:

- Project purpose and main responsibilities.
- High-level architecture and module structure.
- Main technologies and dependencies.
- Important components and their interactions.
- Key technical decisions and conventions.
- Essential entry points and data flows.

Keep this file short, structured, and easy for an AI agent to understand when resuming development with no prior context.

Update it only when meaningful architectural changes occur. Avoid implementation details that can be easily rediscovered in the code.

### Restrictions

- Never create, modify, rename, or delete other Markdown files unless explicitly requested.
- Treat all other Markdown documentation as read-only instructions.
- Do not automatically rewrite or reformat documentation.
- Keep allowed documentation updates minimal and relevant to actual changes.
- Never invent undocumented features or architectural decisions.

## This Project

Read and follow [docs/PROJECT.md](docs/PROJECT.md) before making changes.
Treat PROJECT.md as the reference for project-specific architecture, technologies, conventions, and constraints.
Follow relevant documentation referenced by PROJECT.md.
Prefer project-specific instructions when they are more precise than these general principles.
Do not introduce changes that conflict with the project's established conventions without explicit justification.
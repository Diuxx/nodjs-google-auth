# General Programming Principles

These principles apply to all programming tasks, regardless of language, framework, or version.

They complement task requirements and repository-specific conventions. When instructions conflict, follow the most specific applicable requirements.

For Node.js backend work, also read and follow [docs/backend-node.md](docs/backend-node.md).

For database design, migrations, and persistence changes,
also read and follow [docs/database.md](docs/database.md).

## 1. Understand Before Changing

- Understand the expected behavior, constraints, and existing implementation before modifying code.
- Inspect relevant files, dependencies, interfaces, and established patterns.
- Reuse existing mechanisms when appropriate instead of creating parallel implementations.
- Preserve existing behavior, public contracts, and data compatibility unless explicitly requested otherwise.
- Identify potential side effects and affected components before making changes.
- Ask for clarification when an ambiguity materially affects correctness or safety. Otherwise, proceed with reasonable, explicit assumptions.

## 2. Design for Maintainability

Prioritize **human readability and maintainability** over cleverness, compactness, or abstraction.

- Prefer the simplest solution that fully satisfies the requirement.
- Use precise, descriptive names that communicate intent.
- Give functions, classes, and modules clear, coherent responsibilities.
- Separate business rules, orchestration, input/output, and data access when their responsibilities justify it.
- Keep dependencies and side effects explicit.
- Favor composition over inheritance when practical.
- Reduce unnecessary nesting using guard clauses and clear control flow.
- Keep related logic together to make navigation and understanding easier.

### Manage Complexity

- Extract complex conditions, business rules, or processing steps into clearly named functions when doing so improves comprehension, even if they are used only once.
- Each function should operate at a coherent level of abstraction.
- Avoid functions that mix unrelated responsibilities.
- Avoid excessive fragmentation into trivial functions that make code harder to follow.
- Prefer explicit, understandable logic over clever shortcuts or dense expressions.
- Keep abstractions proportional to the actual complexity of the problem.

Apply **SOLID, KISS, DRY, and YAGNI pragmatically**, not dogmatically.

Design patterns should solve concrete problems, never introduce complexity for its own sake.

## 3. Respect Existing Architecture

- Follow the repository's established architecture, naming conventions, and coding style.
- Do not introduce new architectural layers, patterns, or dependencies without a concrete benefit.
- Keep changes focused on the requested functionality.
- Avoid unrelated refactoring or formatting changes.
- Reuse shared logic only when responsibilities and behavior genuinely align.
- Maintain clear boundaries between components and modules.
- Prefer incremental improvements over unnecessary rewrites.

When existing code is problematic, improve the parts necessary for the task without expanding its scope unnecessarily.

## 4. Handle Errors and Edge Cases

- Validate inputs at system boundaries and enforce business invariants where they belong.
- Handle errors explicitly at the appropriate abstraction level.
- Never silently ignore failures or replace errors with misleading success values.
- Avoid overly broad exception handling.
- Preserve useful error context while preventing sensitive information leakage.
- Consider missing data, invalid states, partial failures, and unavailable dependencies.
- Make retry behavior, idempotency, and concurrency handling explicit when relevant.
- Protect data integrity during updates, migrations, and destructive operations.

## 5. Security and Data Integrity

- Treat all external input as untrusted.
- Apply least privilege and enforce authorization at the resource boundary.
- Never expose secrets, credentials, tokens, or sensitive information in source code, logs, or error responses.
- Use safe defaults and established security mechanisms.
- Preserve backward compatibility for persisted data unless migration is explicitly required.
- Make data migrations intentional, testable, and recoverable where practical.
- Avoid destructive operations without appropriate safeguards.

## 6. Comments and Documentation

Code should explain **what it does** through its structure and naming.

Comments should explain **why a decision was made**, especially when the reason is not obvious.

- Avoid comments that merely restate the implementation.
- Document non-obvious behavior, constraints, trade-offs, and compatibility requirements.
- Add a concise explanation at a complex function when its purpose, algorithm, invariants, side effects, or important assumptions are not clear from its name and implementation.
- For a complex public or reusable function, document its contract: expected inputs, result, relevant side effects, and meaningful failure cases, using the language's established documentation style.
- Prefer improving names or simplifying the function when that would make a comment unnecessary.
- Keep comments accurate as the implementation changes; do not add comments to every function by default.
- Keep documentation consistent with the actual implementation.
- Update relevant documentation when APIs, behavior, configuration, or usage changes.
- Avoid excessive documentation for self-explanatory code.

## 7. Testing and Verification

- Test observable behavior rather than implementation details.
- Cover expected behavior, important boundaries, and meaningful failure scenarios.
- Prefer deterministic, isolated, and reproducible tests.
- Use existing testing tools and conventions.
- Add tests proportionate to the complexity and risk of the change.
- Avoid unnecessary mocks and tests tightly coupled to internal implementation.
- Run relevant existing tests, checks, and builds whenever possible.
- Review changes for regressions, unintended side effects, and compatibility issues.
- Never claim a verification was performed unless it actually was.

## 8. Agent Workflow

For each development task:

1. **Inspect** — Understand the relevant code, architecture, conventions, and tests.
2. **Plan** — Identify the smallest coherent change and its potential impacts.
3. **Implement** — Write readable, focused code that respects existing patterns.
4. **Verify** — Run relevant checks and test important behavior and failure cases.
5. **Simplify** — Review the implementation for unnecessary complexity, duplication, and abstractions.
6. **Report** — Summarize the changes, technical decisions, checks performed, and remaining limitations.

Do not generate extensive plans or explanations for trivial changes.

## 9. Delivery Standards

Before considering a task complete:

- Ensure the implementation satisfies the requested behavior.
- Remove unused code, unnecessary abstractions, and debugging artifacts.
- Check that naming, responsibilities, and control flow remain understandable.
- Verify that existing functionality and contracts are preserved where required.
- Keep the final diff focused and reviewable.
- Clearly distinguish verified behavior from assumptions or untested functionality.

**The goal is not to produce the most sophisticated code, but the simplest maintainable implementation that correctly solves the problem.**
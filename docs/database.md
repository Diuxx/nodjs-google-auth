# Database Design & Persistence Guidelines

These principles apply to database design, data access, schema evolution, and persistence operations.

They are independent of the database engine, programming language, ORM, or framework.

Follow existing project conventions and architecture. Do not introduce a database, ORM, or persistence abstraction unless the requirement justifies it.

## 1. Data Modeling

Design the data model around business concepts and their relationships.

- Use meaningful, consistent names for tables, columns, and relationships.
- Give each table a clear responsibility.
- Define primary keys and foreign keys explicitly.
- Represent relationships using appropriate cardinalities and constraints.
- Avoid unnecessary duplication and derived data unless justified by a concrete requirement.
- Normalize data by default. Denormalize only when a measured need justifies the trade-off.
- Choose appropriate data types, lengths, precision, and nullability.
- Distinguish optional data from missing or invalid data.
- Use stable identifiers that do not depend on mutable business attributes.

Prefer a clear and understandable schema over unnecessary flexibility or generic structures.

## 2. Naming Conventions

- Follow the naming conventions already established by the project.
- Use consistent naming for tables, columns, constraints, and indexes.
- Prefer descriptive names over abbreviations.
- Avoid reserved keywords and ambiguous terms.
- Maintain consistent naming between database objects and application models where appropriate.
- Do not rename existing database objects solely for stylistic consistency.

If the project has no established naming convention, define one before introducing multiple new database objects.

## 3. Data Integrity

Enforce data integrity at the appropriate level.

- Use database constraints for invariants that must always hold, such as uniqueness, referential integrity, and required values.
- Keep business-specific validation in the appropriate application layer.
- Do not rely exclusively on application validation to guarantee database consistency.
- Define deletion behavior explicitly, especially for related records.
- Avoid cascading deletions unless their consequences are fully understood.
- Use transactions when multiple operations must succeed or fail together.
- Never leave partially updated data when atomicity is required.

The database should protect its own structural integrity, while the application enforces its business rules.

## 4. Queries and Performance

Prioritize correctness and readability before optimization.

- Retrieve only the data required by the operation.
- Avoid unnecessary queries and repeated database round trips.
- Identify and prevent N+1 query problems.
- Use pagination for potentially large result sets.
- Add indexes according to actual query patterns and constraints.
- Avoid unnecessary indexes that increase write costs and maintenance.
- Inspect query plans when investigating performance issues.
- Measure performance before introducing complex optimizations.
- Make ordering explicit when deterministic results are required.

Do not sacrifice maintainability for hypothetical performance gains.

## 5. Data Access Architecture

Keep persistence concerns separate from business rules.

- Follow the existing repository, DAO, ORM, or direct-query conventions.
- Centralize data access where it improves consistency and maintainability.
- Keep queries, transactions, and persistence-specific behavior within appropriate boundaries.
- Avoid leaking database-specific details into unrelated application layers.
- Do not introduce generic repositories or additional abstraction layers without a concrete need.
- Make transaction boundaries explicit.
- Handle persistence errors without hiding their underlying meaning.

Prefer straightforward data access over unnecessary architectural complexity.

## 6. Schema Migrations

Treat database schema changes as versioned, controlled operations.

- Use the migration mechanism already established by the project.
- Keep schema changes reproducible and reviewable.
- Never modify an already-applied migration in a shared environment.
- Make migrations deterministic and compatible with the target database engine.
- Preserve existing data unless destructive changes are explicitly required.
- Consider backward compatibility between application versions and database schemas.
- Prefer incremental migrations for potentially breaking changes.
- Plan data transformations separately when their complexity justifies it.
- Consider rollback, recovery, and backup strategies before destructive operations.

Never rely on automatic schema generation to modify production databases unless the project explicitly supports and controls that approach.

## 7. Transactions and Concurrency

- Use transactions to protect operations requiring atomicity.
- Keep transactions as short as reasonably possible.
- Avoid external network calls inside database transactions unless explicitly justified.
- Consider concurrent reads, updates, and deletions.
- Use optimistic or pessimistic locking when the business operation requires it.
- Detect and handle conflicting updates rather than silently overwriting data.
- Design retry behavior carefully to avoid duplicate operations or inconsistent state.
- Respect the isolation capabilities and guarantees of the chosen database.

Do not add concurrency mechanisms without identifying the problem they solve.

## 8. Security

- Use parameterized queries or ORM parameter binding.
- Never construct SQL queries by concatenating untrusted values.
- Validate and constrain external inputs.
- Apply least privilege to database accounts and permissions.
- Keep credentials and connection strings containing secrets out of source control.
- Avoid logging sensitive records, credentials, or raw query parameters containing personal data.
- Enforce authorization before accessing or modifying protected data.
- Protect sensitive data according to its requirements and the project's security architecture.

## 9. Testing and Verification

Test persistence behavior and data integrity, not only application logic.

- Test important constraints and relationships.
- Verify transaction rollback behavior when relevant.
- Test migrations against representative existing schemas and data.
- Cover meaningful concurrency and conflict scenarios.
- Verify important queries using realistic datasets when appropriate.
- Prefer integration tests for behavior that depends on database-specific guarantees.
- Keep test data isolated and reproducible.
- Never run destructive tests against production data.

## 10. Before Delivery

Review database changes for:

- Correctness of the data model and relationships.
- Consistency with established naming conventions.
- Data integrity and transaction safety.
- Migration compatibility and preservation of existing data.
- Query performance and indexing where relevant.
- Security and access control.
- Tests and documentation.

Clearly report migrations introduced, compatibility considerations, checks performed, and remaining risks.

**The goal is a simple, reliable, and maintainable persistence model that preserves data integrity throughout the application's lifecycle.**
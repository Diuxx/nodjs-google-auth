# Node.js Backend Practices

These guidelines apply to backend changes in this repository. Follow the task requirements and existing code conventions when they are more specific. Prefer clear, reliable behavior over unnecessary abstractions or dependencies.

## Node.js and project structure

- Use the Node.js version and package scripts declared by the project; do not assume that APIs available in a newer runtime are supported.
- Keep using ES modules and the existing Fastify-based application structure.
- Keep responsibilities separated: HTTP routes handle request and response concerns, while reusable business logic belongs in the appropriate service or library.
- Keep configuration in the existing configuration layer. Read and validate environment settings at startup rather than scattering environment lookups throughout the application.
- Prefer Node.js built-ins and existing dependencies. Add a dependency only when it provides clear value that cannot be met reasonably with the existing code.
- Avoid synchronous work that could block the event loop, especially in request handlers. Keep existing synchronous SQLite operations small and bounded.

## HTTP routes and API behavior

- Define request schemas and validate untrusted input at the HTTP boundary.
- Use the existing Fastify route-registration and error-handling patterns. Keep handlers focused and move reusable or non-trivial business logic out of them.
- Return appropriate HTTP status codes and consistent response shapes. Do not expose internal stack traces, database details, tokens, or other sensitive values to clients.
- Make authentication and authorization explicit on every protected operation. Do not rely on the client interface to enforce access control.
- Configure cross-origin access as an explicit allowlist. For cookie-based requests, preserve the project's origin checks and cookie security settings.
- Set caching behavior intentionally, especially for responses containing user-specific data, status information, or secrets.
- Keep machine-oriented health and status endpoints distinct from human-facing documentation and status displays. Report only checks that are actually performed.

## Errors, logging, and secrets

- Let failures reach the established error handler or handle them where recovery is deliberate and well-defined. Do not silently convert failures into success-shaped responses.
- Use the project's structured logger for server-side diagnostics. Include useful context, but redact credentials, cookies, OAuth codes, and personal data.
- Return safe, actionable error messages to clients without leaking implementation details.
- Keep secrets outside source control and never include them in HTML, API responses, logs, or error messages.

## Data and security

- Use parameterized database queries; never build SQL by interpolating untrusted input.
- Validate and constrain data before storing or passing it to external services.
- Apply least privilege, verify ownership and authorization on the server, and use secure defaults for sessions and cookies.
- Treat data returned by external services as untrusted too; handle missing, malformed, or unexpected values explicitly.
- Consider request size, rate of work, timeouts, retries, and duplicate requests when they affect resource usage or correctness.

## Testing and maintenance

- Add or update tests for externally observable behavior, including relevant failure and boundary cases.
- Keep tests deterministic and isolated from real user accounts, production services, and persistent production data.
- Run the relevant checks already defined by the project and review the diff before considering a change complete.
- Update documentation when an API contract, route, operational behavior, or user-facing feature changes.

## Human-facing API page at `/`

- Keep a useful, polished HTML page at `GET /` that explains what the API is for and gives visitors relevant, understandable information about the service.
- Build the page with semantic HTML and responsive CSS. Make it usable with a keyboard and assistive technology; do not communicate status through color alone.
- Serve stylesheets and scripts as separate assets, following the existing approach. Avoid inline scripts and unnecessary client-side frameworks or dependencies.
- If the page displays live status or statistics, retrieve them from an explicit public endpoint and show clear loading, success, and failure states. Never invent example values as if they were live.
- Expose only information intended to be public. Use aggregate data where appropriate; never include email addresses, account identifiers, session details, credentials, or tokens.
- Describe the scope of each status accurately. A successful local API or database check must not imply that an external provider or every dependent service is available.
- Keep the page informational and safe to visit without authentication. Link to a demonstration or interactive feature only when one exists and is intended for public use.
- Cover the page and its public status response with tests, including asset delivery, response shape, and the absence of sensitive data.

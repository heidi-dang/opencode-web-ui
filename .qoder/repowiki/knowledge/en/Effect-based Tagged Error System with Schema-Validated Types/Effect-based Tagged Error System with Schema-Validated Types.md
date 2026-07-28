---
kind: error_handling
name: Effect-based Tagged Error System with Schema-Validated Types
category: error_handling
scope:
    - '**'
source_files:
    - packages/core/src/account.ts
    - packages/core/src/aisdk.ts
    - packages/core/src/control-plane/move-session.ts
    - packages/client/src/generated-effect/client-error.ts
    - packages/app/src/utils/server-errors.ts
    - packages/app/src/pages/layout/helpers.ts
    - packages/app/src/pages/error-description.ts
---

The codebase uses the Effect ecosystem's `Schema.TaggedErrorClass` as its primary error-handling mechanism, creating strongly-typed, schema-validated error types throughout the core and client packages. This approach replaces traditional JavaScript `Error` subclasses with Effect-native tagged errors that carry structured data fields validated by Effect Schema definitions.

**Core Pattern**: Each domain module defines specific error classes using `Schema.TaggedErrorClass<T>()("TagName", { fields })`, where each field is an Effect Schema type. Examples include `AccountRepoError`, `AccountServiceError`, `AISDK.InitError`, `MoveSession.DestinationProjectMismatchError`, `Git.OperationError`, and many others across packages like `core/src/account.ts`, `core/src/aisdk.ts`, and `core/src/control-plane/move-session.ts`. These errors are then propagated through Effect pipelines using `yield* new ErrorType({...})` syntax.

**Error Propagation**: The system leverages Effect's `Effect.Effect<Success, Error>` type signature pattern, where functions declare their potential error types in the second type parameter. Errors flow through the pipeline via `Effect.mapError()` transformations and are caught using `Effect.catchCause()` patterns. The `initError` helper in `aisdk.ts` demonstrates this pattern: `Effect.catchCause((cause) => Effect.fail(new InitError({ providerID, cause: Cause.squash(cause) })))`.

**Client-Side Handling**: The generated client package includes a `ClientError` class for HTTP client failures, while the app layer provides utility functions in `packages/app/src/utils/server-errors.ts` for formatting and interpreting server errors. Functions like `formatServerError()`, `isLocalSessionNotFoundError()`, and `isSessionNotFoundError()` handle error unwrapping and user-friendly message generation, supporting both Effect errors and plain JavaScript errors.

**UI Integration**: The presentation layer uses helper functions like `errorMessage()` in `packages/app/src/pages/layout/helpers.ts` to extract readable messages from various error formats, supporting both structured error objects with `data.message` properties and standard JavaScript `Error` instances. Error descriptions are localized through translation keys managed by `errorDescriptionKey()`.

**Database and Transport Errors**: SQLite operations use `classifySqliteError()` from `effect/unstable/sql/SqlError` for database-specific error classification. Network transport errors are wrapped in typed classes like `AccountTransportError.fromHttpClientError()` that preserve request context (method, URL, description).

**Conventions**: All domain errors follow consistent naming (`XxxError` suffix), include descriptive tags for pattern matching, and maintain optional `cause` fields for error chaining. Business logic errors are distinguished from infrastructure errors through separate error classes within each domain module.
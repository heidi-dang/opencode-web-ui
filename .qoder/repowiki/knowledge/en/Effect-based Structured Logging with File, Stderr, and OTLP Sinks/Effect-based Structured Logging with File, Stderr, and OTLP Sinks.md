---
kind: logging_system
name: Effect-based Structured Logging with File, Stderr, and OTLP Sinks
category: logging_system
scope:
    - '**'
source_files:
    - packages/core/src/observability/logging.ts
    - packages/core/src/observability/otlp.ts
    - packages/core/src/observability.ts
    - packages/core/src/observability/shared.ts
---

The application uses the Effect Framework's built-in `Logger` system for structured logging, composed through Effect Layers to support multiple output sinks. The logging subsystem lives under `packages/core/src/observability/` and integrates both local file/stderr logging and OpenTelemetry OTLP export.

**Framework and Architecture**
- Built on `effect.Logger` with a custom formatter that produces key=value structured log lines (not JSON). The formatter flattens nested plain objects into dot-separated keys, handles circular references via WeakSet tracking, and wraps non-safe values in JSON strings.
- Loggers are provided as Effect Layers and merged together: `Logger.layer([...Logging.loggers(), ...Otlp.loggers()], { mergeWithExisting: false })`, ensuring no existing logger is replaced.
- A global `runID` (8-char UUID prefix) is attached to every log entry as a `run` field, enabling correlation across outputs.

**Sinks**
1. **File sink** (`fileLogger`): Writes to `opencode.log` under `Global.Path.log` using append mode. Uses a non-zero `batchWindow` to avoid high idle CPU usage.
2. **Stderr sink** (`stderrLogger`): Custom `Logger.make` that writes formatted lines to `process.stderr`. Only enabled when `OPENCODE_PRINT_LOGS=1`.
3. **OTLP sink** (`OtlpLogger`): Conditionally enabled when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; exports logs to `${endpoint}/v1/logs` with resource attributes including service name, version, deployment environment, client identifier, and run ID.

**Log Levels**
- Controlled by `OPENCODE_LOG_LEVEL` environment variable, mapped to Effect's LogLevel enum: DEBUG, INFO (default), WARN, ERROR.
- Set via `References.MinimumLogLevel` so all downstream loggers respect the threshold.

**Conventions**
- All log entries include at minimum: `timestamp`, `level`, `run`, and `message` fields.
- Optional fields: `cause` (for error context), flattened `spans` and `annotations` from Effect's structured logging.
- Nested plain objects are recursively flattened into dot-notation keys (e.g., `user.id`, `request.method`).
- Circular object references are detected and replaced with `[Circular]`.
- Non-string values are formatted via `Formatter.format` and JSON-stringified if they contain spaces or special characters.

**Integration Points**
- The observability layer is exposed as `Observability.node` and provides the combined Logger layer plus OTLP tracing setup.
- Tests mock the logger by providing a file logger with `NodeFileSystem.layer`.
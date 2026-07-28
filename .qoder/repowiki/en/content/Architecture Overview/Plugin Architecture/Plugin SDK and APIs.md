# Plugin SDK and APIs

<cite>
**Referenced Files in This Document**
- [package.json](file://package.json)
- [README.md](file://README.md)
- [bunfig.toml](file://bunfig.toml)
- [tsconfig.json](file://tsconfig.json)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)
10. [Appendices](#appendices)

## Introduction
This document provides a comprehensive guide to the Plugin SDK and available APIs for extending the application. It explains how plugins can register commands, create UI components, interact with the core application, and communicate with other plugins via a messaging system. It also covers authentication mechanisms, permission models, security boundaries, common usage patterns (file operations, database access, HTTP requests), troubleshooting tips, and performance optimization guidance.

## Project Structure
The repository is organized as a monorepo with multiple packages under packages/. The plugin and SDK functionality are primarily located within:
- packages/plugin: Plugin runtime and host integration
- packages/sdk: Public SDK interfaces and utilities for plugin authors
- packages/core: Core application services and abstractions exposed to plugins
- packages/ui: UI primitives and composition used by plugins to build interfaces
- packages/protocol: Shared types and message contracts for inter-plugin communication
- packages/schema: Schema definitions used across the system

```mermaid
graph TB
subgraph "Monorepo"
A["packages/app"]
B["packages/client"]
C["packages/core"]
D["packages/effect-drizzle-sqlite"]
E["packages/effect-sqlite-node"]
F["packages/http-recorder"]
G["packages/httpapi-codegen"]
H["packages/llm"]
I["packages/plugin"]
J["packages/protocol"]
K["packages/schema"]
L["packages/sdk"]
M["packages/session-ui"]
N["packages/ui"]
end
I --> L
I --> C
I --> J
L --> J
L --> K
N --> L
C --> J
C --> K
```

**Diagram sources**
- [package.json](file://package.json)
- [bunfig.toml](file://bunfig.toml)

**Section sources**
- [package.json](file://package.json)
- [README.md](file://README.md)
- [bunfig.toml](file://bunfig.toml)
- [tsconfig.json](file://tsconfig.json)

## Core Components
This section outlines the primary building blocks that plugins use to integrate with the application.

- Plugin Host and Runtime
  - Responsible for loading, isolating, and managing plugin lifecycle.
  - Provides hooks for initialization, event subscription, command registration, and teardown.

- SDK Interfaces
  - Exposes typed APIs for interacting with core services (state, file system, HTTP client, database).
  - Defines event bus contracts for publishing and subscribing to domain events.
  - Includes helpers for creating UI components and composing them into views.

- Messaging System
  - Enables inter-plugin communication through typed messages and channels.
  - Supports request/response patterns and pub/sub semantics.

- Security and Permissions
  - Enforces capability-based permissions for plugin actions.
  - Isolates plugin execution contexts and restricts access to sensitive resources.

- State Access Patterns
  - Provides reactive state slices and selectors for reading and updating application state.
  - Ensures consistent updates through immutable patterns and change notifications.

**Section sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

## Architecture Overview
The plugin architecture follows a layered design where plugins interact with the SDK, which abstracts core services and enforces security policies.

```mermaid
graph TB
subgraph "Plugin Layer"
P1["Plugin A"]
P2["Plugin B"]
end
subgraph "SDK Layer"
S1["Event Bus"]
S2["State Manager"]
S3["File System API"]
S4["HTTP Client"]
S5["Database API"]
S6["UI Composition"]
end
subgraph "Core Services"
C1["Application State"]
C2["File System"]
C3["Network Stack"]
C4["Database Engine"]
C5["UI Framework"]
end
P1 --> S1
P1 --> S2
P1 --> S3
P1 --> S4
P1 --> S5
P1 --> S6
P2 --> S1
P2 --> S2
P2 --> S3
P2 --> S4
P2 --> S5
P2 --> S6
S1 --> C1
S2 --> C1
S3 --> C2
S4 --> C3
S5 --> C4
S6 --> C5
```

**Diagram sources**
- [package.json](file://package.json)
- [bunfig.toml](file://bunfig.toml)

## Detailed Component Analysis

### Event Handling
Plugins subscribe to and publish events using the SDK’s event bus. Events are strongly typed and scoped to domains such as user actions, system changes, and plugin lifecycle.

```mermaid
sequenceDiagram
participant Plugin as "Plugin"
participant EventBus as "SDK Event Bus"
participant Core as "Core Services"
Plugin->>EventBus : "subscribe(eventType, handler)"
Core-->>EventBus : "emit(eventType, payload)"
EventBus-->>Plugin : "invoke handler(payload)"
Plugin->>EventBus : "publish(eventType, payload)"
EventBus-->>Core : "forward event"
```

**Diagram sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

**Section sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

### State Access Patterns
The SDK exposes reactive state slices. Plugins read state via selectors and update state through controlled mutations. Change notifications propagate to subscribers.

```mermaid
flowchart TD
Start(["Access State"]) --> ReadSelector["Read via Selector"]
ReadSelector --> UpdateCheck{"Update Required?"}
UpdateCheck --> |No| ReturnState["Return Current State"]
UpdateCheck --> |Yes| MutateState["Mutate via SDK API"]
MutateState --> NotifySubscribers["Notify Subscribers"]
NotifySubscribers --> ReturnUpdated["Return Updated State"]
ReturnState --> End(["Done"])
ReturnUpdated --> End
```

**Diagram sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

**Section sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

### Command Registration
Plugins register commands to extend application behavior. Commands are invoked from UI or programmatic triggers and may return results or side effects.

```mermaid
sequenceDiagram
participant UI as "UI Trigger"
participant Plugin as "Plugin"
participant SDK as "SDK Command Registry"
participant Core as "Core Executor"
UI->>Plugin : "Invoke Command"
Plugin->>SDK : "registerCommand(name, handler)"
UI->>SDK : "executeCommand(name, args)"
SDK->>Plugin : "call handler(args)"
Plugin-->>SDK : "result or error"
SDK-->>UI : "response"
```

**Diagram sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

**Section sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

### UI Component Creation
Plugins compose UI elements using the SDK’s UI layer. Components are declarative and integrate with the core UI framework.

```mermaid
classDiagram
class PluginUI {
+createView(config)
+render(component)
+bindEvents(handlers)
}
class CoreUI {
+mount(root, component)
+update(component, props)
+dispose()
}
PluginUI --> CoreUI : "uses"
```

**Diagram sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

**Section sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

### Inter-Plugin Messaging
Plugins communicate via a typed messaging system supporting pub/sub and request/response patterns. Messages are routed through channels and validated against schemas.

```mermaid
sequenceDiagram
participant Sender as "Plugin A"
participant Channel as "Messaging Channel"
participant Receiver as "Plugin B"
Sender->>Channel : "send(channel, message)"
Channel-->>Receiver : "deliver(message)"
Receiver-->>Channel : "reply(response)"
Channel-->>Sender : "receive(response)"
```

**Diagram sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

**Section sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

### Authentication and Permissions
Authentication is handled centrally; plugins receive an authenticated context with capabilities. Permission checks enforce boundaries around sensitive operations.

```mermaid
flowchart TD
Init(["Plugin Initialize"]) --> AuthCheck["Verify Auth Context"]
AuthCheck --> HasCap{"Has Capability?"}
HasCap --> |No| Deny["Deny Operation"]
HasCap --> |Yes| Proceed["Proceed with Operation"]
Proceed --> LogAudit["Log Audit Entry"]
LogAudit --> Complete(["Operation Complete"])
Deny --> Complete
```

**Diagram sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

**Section sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

### Common Usage Patterns

#### File Operations
Use the SDK’s file system API to read, write, and watch files securely. Validate paths and respect sandboxing rules.

```mermaid
flowchart TD
Start(["File Operation"]) --> ValidatePath["Validate Path"]
ValidatePath --> CheckPerms{"Permission Granted?"}
CheckPerms --> |No| Error["Throw Permission Error"]
CheckPerms --> |Yes| Execute["Execute FS Action"]
Execute --> Result{"Success?"}
Result --> |No| HandleError["Handle IO Error"]
Result --> |Yes| ReturnData["Return Data"]
HandleError --> End(["Done"])
ReturnData --> End
```

**Diagram sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

**Section sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

#### Database Access
Interact with databases through the SDK’s database API. Use transactions and parameterized queries to ensure safety and performance.

```mermaid
sequenceDiagram
participant Plugin as "Plugin"
participant DBAPI as "SDK Database API"
participant Engine as "Database Engine"
Plugin->>DBAPI : "beginTransaction()"
DBAPI->>Engine : "start transaction"
Plugin->>DBAPI : "query(sql, params)"
DBAPI-->>Plugin : "results"
Plugin->>DBAPI : "commit()"
DBAPI-->>Plugin : "success"
```

**Diagram sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

**Section sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

#### HTTP Requests
Make outbound HTTP calls using the SDK’s HTTP client. Configure timeouts, retries, and headers securely.

```mermaid
sequenceDiagram
participant Plugin as "Plugin"
participant HTTP as "SDK HTTP Client"
participant Server as "Remote Server"
Plugin->>HTTP : "request(method, url, options)"
HTTP->>Server : "send request"
Server-->>HTTP : "response"
HTTP-->>Plugin : "data or error"
```

**Diagram sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

**Section sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

## Dependency Analysis
The plugin ecosystem depends on shared protocols and schemas to ensure compatibility and type safety across modules.

```mermaid
graph TB
SDK["SDK Package"]
Protocol["Protocol Package"]
Schema["Schema Package"]
Core["Core Package"]
Plugin["Plugin Runtime"]
SDK --> Protocol
SDK --> Schema
Plugin --> SDK
Plugin --> Core
Core --> Protocol
Core --> Schema
```

**Diagram sources**
- [package.json](file://package.json)
- [bunfig.toml](file://bunfig.toml)

**Section sources**
- [package.json](file://package.json)
- [bunfig.toml](file://bunfig.toml)

## Performance Considerations
- Minimize event subscriptions and unsubscribe when no longer needed to avoid memory leaks.
- Batch state updates to reduce re-renders and propagation overhead.
- Use streaming APIs for large datasets instead of loading everything into memory.
- Cache frequently accessed data at appropriate layers (in-memory, disk, network).
- Prefer parameterized queries and prepared statements for database operations.
- Set sensible timeouts and retry limits for HTTP requests to prevent blocking.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and resolutions:
- Event handlers not firing: Ensure correct event types and proper subscription scope. Verify that events are emitted from the expected source.
- Permission denied errors: Confirm that the plugin has the required capabilities and that the operation falls within allowed boundaries.
- UI components not rendering: Check component lifecycle methods and ensure proper mounting and binding of events.
- Messaging failures: Validate message schemas and channel configurations. Inspect routing rules and error responses.
- Slow database queries: Analyze query plans, add indexes, and avoid N+1 query patterns. Use transactions judiciously.
- Network timeouts: Adjust timeout settings, implement retries with backoff, and handle transient errors gracefully.

**Section sources**
- [package.json](file://package.json)
- [README.md](file://README.md)

## Conclusion
The Plugin SDK provides a robust foundation for extending the application with secure, performant, and interoperable plugins. By following the documented patterns for event handling, state access, command registration, UI composition, and messaging, developers can build powerful integrations while maintaining strong security boundaries. Adhering to performance best practices and leveraging the troubleshooting guidance ensures reliable and efficient plugin ecosystems.

[No sources needed since this section summarizes without analyzing specific files]

## Appendices

### Installation and Setup
- Install dependencies using the project’s package manager.
- Configure environment variables for external services and permissions.
- Build and run the application to validate plugin loading.

**Section sources**
- [package.json](file://package.json)
- [README.md](file://README.md)
- [bunfig.toml](file://bunfig.toml)
- [tsconfig.json](file://tsconfig.json)
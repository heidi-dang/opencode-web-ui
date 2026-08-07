# Todo Live Synchronization Design

## Goal

Keep the session todo dock synchronized with the current agent todo statuses, including updates that preserve the todo count.

## Design

The composer controller will derive a stable signature from the ordered todo items and include it in the todo lifecycle effect dependencies. The signature includes each item's content, status, and priority, so status transitions such as `pending` → `in_progress` and `in_progress` → `completed` trigger the same lifecycle evaluation as list replacement. Existing event transport, revision guards, dismissal behavior, and rendering remain unchanged.

## Testing

Add a pure regression assertion that distinguishes same-length todo lists when an item's status changes. Run the focused app unit suite and typecheck; document the existing client-only router limitation if it prevents the full composer suite from running in the current headless environment.

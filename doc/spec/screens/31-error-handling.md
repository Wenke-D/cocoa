# 31. Error Handling

Errors must be shown near the relevant operation.

## Start Failure

- Stay on the Start page.
- Show inline error.
- Preserve parameter input.
- Allow retry.

## Cancel Failure

- Keep the user on the detail page.
- Restore the previous execution status.
- Show a visible error notification.

## Query Failure

- Do not mark execution Failed.
- Display Unknown/query unavailable.
- Show last known execution state.
- Show last successful query time.
- Provide Retry Now.

## Invalid Manifest

- Keep entity visible in the Explorer.
- Show specific validation reason.
- Disable Start.

## Missing Entity

If a route references a removed entity:

- Return to the empty page or the first available entity.
- Do not panic.

## Missing Run

If a route references a missing run:

- Return to the owning entity overview.
- Show a temporary message.
- Do not panic.

## Report Read Error

Show:

```text
Unable to read report.

<error message>
```

Keep the user on the report or detail page.

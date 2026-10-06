# 25. Keyboard and Focus Behavior

Required:

```text
Command/Control + Enter   Start from the Start page
Escape                    Close current modal
Command/Control + F       Focus report search when in report viewer
```

Optional:

```text
Alt + Left                Navigate to parent route
Command + [               Navigate to parent route on macOS
F5                        Manual refresh
```

Focus requirements:

- Opening the Start page focuses the parameter field.
- Opening report search focuses the search field only when explicitly invoked.
- Closing a modal returns focus to the action that opened it when practical.
- Keyboard focus must not remain trapped after a modal closes.

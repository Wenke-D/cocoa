# 7. Fundamental UX Decisions

The UI must follow these decisions.

## 7.1 Viewing Has Higher Priority Than Starting

The selected Job or Campaign overview primarily shows:

1. Current state.
2. Active runs.
3. Historical runs.
4. Reports.
5. Start action.

The parameter input must not permanently occupy the overview page.

Starting is a temporary action and must happen in a modal.

## 7.2 Two Persistent Regions Only

The main window has only two persistent content regions:

```text
Left: Sidebar
Right: Unified main-content region
```

Do not create a permanent third inspector column.

The activity bar (§8.2) and the status bar (§8.5) are chrome, not content regions. The activity bar chooses which view the one sidebar shows; it never holds content of its own.

Job details, Campaign details, child-run details, and reports must open in the main-content region.

## 7.3 Full-Page Details

Clicking a run-history row must navigate the main-content region to a complete run-detail page.

Do not show run details only in a narrow side panel.

## 7.4 Full-Page Reports

Clicking an available report must open the report viewer in the main-content region.

Do not show long reports in a tooltip, narrow panel, or small modal.

An HTML report opens in the browser, but the viewer page still exists and is
still full-page: it identifies the report, offers the source, and hosts the
`Open in Browser` action (§20).

## 7.5 Automatic Query

The application automatically updates active runs.

The user should not need to repeatedly press Query.

A small Refresh control may exist, but it is secondary.

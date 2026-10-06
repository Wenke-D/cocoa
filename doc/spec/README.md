# Development specification

What cocoa must do, how it is built, and the contracts it keeps — one file per
numbered section, in a folder per area. For using cocoa rather than working on
it, read the [user manual](../manual/overview.md) instead.

## Section index

Every rule in this documentation has a number, and the source cites those
numbers: a comment reading `(§15.4)` in `StartRun.svelte` means the Submission
rules of [§15](screens/15-start-page.md). There are around 400 such citations in the
code, which is why the numbering survived the documents being split up — and
then sorted into this specification and the [user manual](../manual/overview.md)
— and why it should not be renumbered. The manual carries no numbers of its
own; where it cites one, the rule is here.

The source writes these two ways, and both mean this table:

```text
(specification §15.4)   a numbered section here
(convention §5)         a numbered section of the convention, which numbers its own
```

If you are looking for a number, this is where it lives. Each area's folder
has a README of its own: what the area is, and its sections in order.

| § | Section | Area |
|---|---|---|
| **1** | [Mission](product/01-mission.md) | product |
| **2** | [Product Model](product/02-product-model.md) | product |
| **3** | [Core Backend Operations](product/03-core-operations.md) | product |
| **4** | [Scope](product/04-scope.md) | product |
| **5** | [Technology Baseline](architecture/05-technology-baseline.md) | architecture |
| **6** | [Supported Platforms](architecture/06-supported-platforms.md) | architecture |
| **7** | [Fundamental UX Decisions](screens/07-ux-decisions.md) | screens |
| **8** | [Application Shell](screens/08-application-shell.md) | screens |
| **9** | [Navigation Model](screens/09-navigation-model.md) | screens |
| **10** | [Domain Types](screens/10-domain-types.md) | screens |
| **11** | [Explorer Sidebar](screens/11-explorer-sidebar.md) | screens |
| **12** | [Empty Page](screens/12-empty-page.md) | screens |
| **13** | [Job Overview Page](screens/13-job-overview-page.md) | screens |
| **14** | [Campaign Overview Page](screens/14-campaign-overview-page.md) | screens |
| **15** | [Start Page](screens/15-start-page.md) | screens |
| **16** | [Cancel and Delete Confirmation Modals](screens/16-confirmation-modals.md) | screens |
| **17** | [Job Run-Detail Page](screens/17-job-run-detail.md) | screens |
| **18** | [Campaign Run-Detail Page](screens/18-campaign-run-detail.md) | screens |
| **19** | [Campaign Child-Run Detail Page](screens/19-campaign-child-run-detail.md) | screens |
| **20** | [Report Viewer](screens/20-report-viewer.md) | screens |
| **21** | [Global Active Runs Indicator](screens/21-active-runs-indicator.md) | screens |
| **22** | [Run-History Table Behavior](screens/22-run-history-table.md) | screens |
| **23** | [Status Presentation](screens/23-status-presentation.md) | screens |
| **24** | [Visual Design](screens/24-visual-design.md) | screens |
| **25** | [Keyboard and Focus Behavior](screens/25-keyboard-and-focus-behavior.md) | screens |
| **26** | [The Engine Boundary](architecture/26-engine-boundary.md) | architecture |
| **27** | [Lifecycle Progression](architecture/27-lifecycle-progression.md) | architecture |
| **28** | [Development Controls](developing/28-development-controls.md) | developing |
| **29** | [Required Demo Fixtures](developing/29-demo-fixtures.md) | developing |
| **30** | [Run Independence](screens/30-run-independence.md) | screens |
| **31** | [Error Handling](screens/31-error-handling.md) | screens |
| **32** | [Persistence](architecture/32-persistence.md) | architecture |
| **33** | [Project Structure](architecture/33-project-structure.md) | architecture |
| **34** | [Application State](architecture/34-application-state.md) | architecture |
| **35** | [Performance Requirements](architecture/35-performance-requirements.md) | architecture |
| **36** | [Accessibility and Usability](screens/36-accessibility.md) | screens |
| **37** | [Testing](developing/37-testing.md) | developing |
| **38** | [Manual Acceptance Scenarios](developing/38-acceptance-scenarios.md) | developing |
| **40** | [Current State and Outstanding Work](developing/40-current-state.md) | developing |
| **41** | [Implementation Constraints](architecture/41-implementation-constraints.md) | architecture |
| **42** | [Deliverables](developing/42-deliverables.md) | developing |
| **43** | [Agent Interface](agent/43-agent-interface.md) | agent |
| **44** | [Definition of Done](developing/44-definition-of-done.md) | developing |
| **45** | [Working on cocoa](developing/45-working-on-cocoa.md) | developing |

### The convention's numbers

[The convention](convention/README.md) numbers its own sections, and the source
cites them as `(convention §5)`.

| § | Section |
|---|---|
| **1** | [Folder layout](convention/01-folder-layout.md) |
| **2** | [`cocoa.toml` — a job](convention/02-job-manifest.md) |
| **3** | [`cocoa.toml` — a campaign](convention/03-campaign-manifest.md) |
| **4** | [Manifest validation](convention/04-manifest-validation.md) |
| **5** | [The private store](convention/05-private-store.md) |
| **6** | [Invocation rules](convention/06-invocation-rules.md) |
| **7** | [Job scripts](convention/07-job-scripts.md) |
| **8** | [Campaign scripts](convention/08-campaign-scripts.md) |
| **9** | [Status](convention/09-status.md) |
| **10** | [When cocoa cannot see a run](convention/10-unreachable-runs.md) |
| **11** | [Reports](convention/11-reports.md) |
| **12** | [What cocoa writes](convention/12-what-cocoa-writes.md) |

### Unnumbered

The working record in [developing/](developing/README.md) also keeps notes no
rule cites, and [ui-system.md](ui-system.md) — the design system — is one
document with no numbers of its own.

- [The two trees](developing/two-trees.md)
- [Running it](developing/running.md)
- [Driving the built app](developing/driving.md)
- [What is already decided](developing/decided.md)
- [Feature gaps against the egui implementation](developing/egui-gaps.md)
- [What testing and driving found](developing/findings.md)
- [Tech debt / pinned versions](developing/tech-debt.md)
- [What is left](developing/left.md)
- [UI system](ui-system.md)

### Retired numbers

Not reused, so old citations stay unambiguous.

| § | Was | Why it went |
|---|---|---|
| 39 | README Requirements | The README exists; a section specifying it does not earn its place. |

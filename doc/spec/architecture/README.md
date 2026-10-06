# Architecture

How the workbench is built, and which of its boundaries are load-bearing.

The short version: the renderer is a web client that holds no domain logic,
the main process is a server that holds all of it, and the folders on disk are
the record. Every section here is an elaboration of those three facts, or a
consequence of them.

## Contents

| | |
|---|---|
| §5 | [Technology Baseline](05-technology-baseline.md) |
| §6 | [Supported Platforms](06-supported-platforms.md) |
| §26 | [The Engine Boundary](26-engine-boundary.md) |
| §27 | [Lifecycle Progression](27-lifecycle-progression.md) |
| §32 | [Persistence](32-persistence.md) |
| §33 | [Project Structure](33-project-structure.md) |
| §34 | [Application State](34-application-state.md) |
| §35 | [Performance Requirements](35-performance-requirements.md) |
| §41 | [Implementation Constraints](41-implementation-constraints.md) |

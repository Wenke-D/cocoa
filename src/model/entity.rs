//! Library entities: Jobs and Benches.
//!
//! A **Job** is an independently runnable experiment.
//!
//! A **Bench** is a fan-out launcher. It does not define, own, or contain Jobs.
//! When started it returns a list of calls to Jobs that already exist in the
//! Library, and dispatches all of them at once (specification §2.2). Nothing in
//! this type therefore describes a pipeline, an ordering, or a child list.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::model::status::ManifestState;

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct EntityId(pub String);

impl EntityId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for EntityId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EntityKind {
    Job,
    Bench,
}

impl EntityKind {
    /// Small uppercase type label used in page headers (specification §13.1).
    pub fn label(self) -> &'static str {
        match self {
            Self::Job => "JOB",
            Self::Bench => "BENCH",
        }
    }

    pub fn start_action(self) -> &'static str {
        match self {
            Self::Job => "Start Job",
            Self::Bench => "Start Bench",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Entity {
    pub id: EntityId,
    pub kind: EntityKind,
    pub name: String,
    /// Displayed with a `~` prefix rather than a platform-absolute path
    /// (specification §24.4).
    pub path: String,
    pub manifest: ManifestState,
    /// Declared parameters of the start form, in manifest order (convention §2).
    pub parameter_names: Vec<String>,
    /// Values used by the most recent start, for the explicit "fill from last
    /// run" action (convention §2, §5).
    pub last_used: BTreeMap<String, String>,
}

impl Entity {
    pub fn is_job(&self) -> bool {
        self.kind == EntityKind::Job
    }

    pub fn is_bench(&self) -> bool {
        self.kind == EntityKind::Bench
    }
}

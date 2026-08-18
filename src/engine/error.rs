//! Error types for the coco engine.

use std::fmt;
use std::path::PathBuf;

/// Every failure the engine can produce.
#[derive(Debug)]
pub enum EngineError {
    /// Filesystem operation failed.
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    /// The private store could not be read or written.
    Store { path: PathBuf, message: String },
    /// A manifest exists but does not load.
    Manifest { path: PathBuf, message: String },
    /// A template failed to parse, validate, or render.
    Template { path: PathBuf, message: String },
    /// A script failed: non-zero exit, timeout, or a missing/invalid
    /// `COCO_RETURN:` contract line.
    Invocation {
        /// The manifest's `command` value, for display.
        script: String,
        exit: Option<i32>,
        timed_out: bool,
        /// Captured stdout + stderr.
        output: String,
    },
    /// A value the user or a script supplied is outside the contract.
    Validation(String),
    /// An entity or run that an operation referenced does not exist.
    NotFound(String),
    /// The path is already registered.
    AlreadyRegistered(PathBuf),
    /// Registration was refused because a valid manifest's platform-wide
    /// unique name collides with an already-registered entity (§5).
    NameCollision(String),
}

impl EngineError {
    pub(crate) fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Self::Io {
            path: path.into(),
            source,
        }
    }

    pub(crate) fn store(path: impl Into<PathBuf>, message: impl Into<String>) -> Self {
        Self::Store {
            path: path.into(),
            message: message.into(),
        }
    }

    pub(crate) fn manifest(path: impl Into<PathBuf>, message: impl Into<String>) -> Self {
        Self::Manifest {
            path: path.into(),
            message: message.into(),
        }
    }

    pub(crate) fn template(path: impl Into<PathBuf>, message: impl Into<String>) -> Self {
        Self::Template {
            path: path.into(),
            message: message.into(),
        }
    }

    pub(crate) fn validation(message: impl Into<String>) -> Self {
        Self::Validation(message.into())
    }

    pub(crate) fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound(message.into())
    }
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io { path, source } => {
                write!(f, "{}: {source}", path.display())
            }
            Self::Store { path, message } => {
                write!(f, "{}: {message}", path.display())
            }
            Self::Manifest { path, message } => {
                write!(f, "{}: {message}", path.display())
            }
            Self::Template { path, message } => {
                write!(f, "{}: {message}", path.display())
            }
            Self::Invocation {
                script,
                exit,
                timed_out,
                output,
            } => {
                let cause = if *timed_out {
                    "timed out".to_owned()
                } else {
                    match exit {
                        Some(code) => format!("exited {code}"),
                        None => "was killed".to_owned(),
                    }
                };
                write!(f, "`{script}` {cause}")?;
                if !output.is_empty() {
                    write!(f, ": {}", output.trim_end())?;
                }
                Ok(())
            }
            Self::Validation(message) => f.write_str(message),
            Self::NotFound(message) => write!(f, "not found: {message}"),
            Self::AlreadyRegistered(path) => {
                write!(f, "already registered: {}", path.display())
            }
            Self::NameCollision(name) => {
                write!(f, "an entity named `{name}` is already registered")
            }
        }
    }
}

impl std::error::Error for EngineError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

impl From<std::io::Error> for EngineError {
    fn from(source: std::io::Error) -> Self {
        Self::Io {
            path: PathBuf::new(),
            source,
        }
    }
}

//! Routes and breadcrumbs.
//!
//! One run record is reachable from two routes (specification §2.3.1). The route
//! you arrived by — not the run's origin — decides which Library row stays
//! selected and what the breadcrumbs say (specification §9.2).

use serde::{Deserialize, Serialize};

use crate::backend::World;
use crate::model::{EntityId, RunId};

/// Where a report was opened from, so the viewer can build a trail back.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReportContext {
    /// A report opened from a Job's own history.
    JobRun { job_id: EntityId },
    /// A Bench run's own summary report.
    BenchRun { bench_id: EntityId },
    /// A report of a run the Bench dispatched, opened from the Bench.
    BenchChildRun {
        bench_id: EntityId,
        bench_run_id: RunId,
    },
}

impl ReportContext {
    pub fn entity_id(&self) -> &EntityId {
        match self {
            Self::JobRun { job_id } => job_id,
            Self::BenchRun { bench_id } | Self::BenchChildRun { bench_id, .. } => bench_id,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum Route {
    #[default]
    EmptyLibrary,

    EntityOverview {
        entity_id: EntityId,
    },

    JobRunDetail {
        job_id: EntityId,
        run_id: RunId,
    },

    BenchRunDetail {
        bench_id: EntityId,
        run_id: RunId,
    },

    /// A run dispatched by a Bench, viewed in the Bench's context.
    ///
    /// The same run also has a [`Route::JobRunDetail`] address. Both render the
    /// same record; only the context differs.
    BenchChildRunDetail {
        bench_id: EntityId,
        bench_run_id: RunId,
        child_run_id: RunId,
    },

    ReportViewer {
        context: ReportContext,
        run_id: RunId,
    },
}

/// One breadcrumb. `route` is `None` for the trailing, current crumb.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Crumb {
    pub label: String,
    pub route: Option<Route>,
}

/// A route repair, plus the message to show the user (specification §31).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Recovery {
    pub route: Route,
    pub message: Option<String>,
}

impl Route {
    /// Which Library row stays highlighted.
    ///
    /// Viewing a dispatched run through a Bench keeps the *Bench* selected, even
    /// though the run belongs to a Job that is also in the Library.
    pub fn selected_entity(&self) -> Option<&EntityId> {
        match self {
            Self::EmptyLibrary => None,
            Self::EntityOverview { entity_id } => Some(entity_id),
            Self::JobRunDetail { job_id, .. } => Some(job_id),
            Self::BenchRunDetail { bench_id, .. } | Self::BenchChildRunDetail { bench_id, .. } => {
                Some(bench_id)
            }
            Self::ReportViewer { context, .. } => Some(context.entity_id()),
        }
    }

    pub fn is_report(&self) -> bool {
        matches!(self, Self::ReportViewer { .. })
    }

    /// The route one level up, used by the back action.
    pub fn parent(&self) -> Option<Self> {
        self.breadcrumbs_raw()
            .into_iter()
            .rev()
            .nth(1)
            .and_then(|crumb| crumb.route)
    }

    /// Breadcrumbs with placeholder labels, used where a `World` is not handy.
    fn breadcrumbs_raw(&self) -> Vec<Crumb> {
        self.crumbs(None)
    }

    pub fn breadcrumbs(&self, world: &World) -> Vec<Crumb> {
        self.crumbs(Some(world))
    }

    fn crumbs(&self, world: Option<&World>) -> Vec<Crumb> {
        let entity_label = |id: &EntityId| match world {
            Some(world) => world.entity_name(id).to_owned(),
            None => id.to_string(),
        };

        let job_run_label = |id: &RunId| match world.and_then(|w| w.job_run(id)) {
            Some(run) => format!("Run {}", run.started_at.format("%Y-%m-%d %H:%M")),
            None => format!("Run {id}"),
        };

        let bench_run_label = |id: &RunId| match world.and_then(|w| w.bench_run(id)) {
            Some(run) => format!("Run {}", run.started_at.format("%Y-%m-%d %H:%M")),
            None => format!("Run {id}"),
        };

        // A plan may call one Job several times, so the leaf must name the
        // parameters too (specification §19).
        let child_label = |bench_run_id: &RunId, child_run_id: &RunId| {
            let world = match world {
                Some(world) => world,
                None => return child_run_id.to_string(),
            };
            let job_name = world
                .job_run(child_run_id)
                .map(|run| world.entity_name(&run.job_id).to_owned())
                .unwrap_or_else(|| "(removed)".to_owned());
            match world
                .bench_run(bench_run_id)
                .and_then(|bench_run| bench_run.plan.step_for_run(child_run_id))
            {
                Some(step) if !step.parameters.trim().is_empty() => {
                    format!("{job_name} {}", step.parameters)
                }
                _ => job_name,
            }
        };

        match self {
            Self::EmptyLibrary => Vec::new(),

            Self::EntityOverview { entity_id } => vec![Crumb {
                label: entity_label(entity_id),
                route: None,
            }],

            Self::JobRunDetail { job_id, run_id } => vec![
                Crumb {
                    label: entity_label(job_id),
                    route: Some(Self::EntityOverview {
                        entity_id: job_id.clone(),
                    }),
                },
                Crumb {
                    label: job_run_label(run_id),
                    route: None,
                },
            ],

            Self::BenchRunDetail { bench_id, run_id } => vec![
                Crumb {
                    label: entity_label(bench_id),
                    route: Some(Self::EntityOverview {
                        entity_id: bench_id.clone(),
                    }),
                },
                Crumb {
                    label: bench_run_label(run_id),
                    route: None,
                },
            ],

            Self::BenchChildRunDetail {
                bench_id,
                bench_run_id,
                child_run_id,
            } => vec![
                Crumb {
                    label: entity_label(bench_id),
                    route: Some(Self::EntityOverview {
                        entity_id: bench_id.clone(),
                    }),
                },
                Crumb {
                    label: bench_run_label(bench_run_id),
                    route: Some(Self::BenchRunDetail {
                        bench_id: bench_id.clone(),
                        run_id: bench_run_id.clone(),
                    }),
                },
                Crumb {
                    label: child_label(bench_run_id, child_run_id),
                    route: None,
                },
            ],

            Self::ReportViewer { context, run_id } => {
                let mut crumbs = match context {
                    ReportContext::JobRun { job_id } => Self::JobRunDetail {
                        job_id: job_id.clone(),
                        run_id: run_id.clone(),
                    }
                    .crumbs(world),
                    ReportContext::BenchRun { bench_id } => Self::BenchRunDetail {
                        bench_id: bench_id.clone(),
                        run_id: run_id.clone(),
                    }
                    .crumbs(world),
                    ReportContext::BenchChildRun {
                        bench_id,
                        bench_run_id,
                    } => Self::BenchChildRunDetail {
                        bench_id: bench_id.clone(),
                        bench_run_id: bench_run_id.clone(),
                        child_run_id: run_id.clone(),
                    }
                    .crumbs(world),
                };

                // The trailing crumb of the parent becomes clickable.
                if let Some(last) = crumbs.last_mut() {
                    last.route = Some(match context {
                        ReportContext::JobRun { job_id } => Self::JobRunDetail {
                            job_id: job_id.clone(),
                            run_id: run_id.clone(),
                        },
                        ReportContext::BenchRun { bench_id } => Self::BenchRunDetail {
                            bench_id: bench_id.clone(),
                            run_id: run_id.clone(),
                        },
                        ReportContext::BenchChildRun {
                            bench_id,
                            bench_run_id,
                        } => Self::BenchChildRunDetail {
                            bench_id: bench_id.clone(),
                            bench_run_id: bench_run_id.clone(),
                            child_run_id: run_id.clone(),
                        },
                    });
                }

                crumbs.push(Crumb {
                    label: "Report".to_owned(),
                    route: None,
                });
                crumbs
            }
        }
    }

    /// Repair a route that points at something no longer there.
    ///
    /// Returns `None` when the route is fine. Never panics, and never leaves the
    /// user on a blank page (specification §31).
    pub fn recover(&self, world: &World) -> Option<Recovery> {
        let fallback = || match world.entities.first() {
            Some(entity) => Route::EntityOverview {
                entity_id: entity.id.clone(),
            },
            None => Route::EmptyLibrary,
        };

        let missing_entity = |id: &EntityId| Recovery {
            route: fallback(),
            message: Some(format!("\"{id}\" is no longer in the Library.")),
        };

        let missing_run = |entity_id: &EntityId| Recovery {
            route: Route::EntityOverview {
                entity_id: entity_id.clone(),
            },
            message: Some("That run is no longer available.".to_owned()),
        };

        match self {
            Route::EmptyLibrary => {
                // Nothing to show, but the Library is no longer empty.
                if world.entities.is_empty() {
                    None
                } else {
                    Some(Recovery {
                        route: fallback(),
                        message: None,
                    })
                }
            }

            Route::EntityOverview { entity_id } => world
                .entity(entity_id)
                .is_none()
                .then(|| missing_entity(entity_id)),

            Route::JobRunDetail { job_id, run_id } => {
                if world.entity(job_id).is_none() {
                    Some(missing_entity(job_id))
                } else if world.job_run(run_id).is_none() {
                    Some(missing_run(job_id))
                } else {
                    None
                }
            }

            Route::BenchRunDetail { bench_id, run_id } => {
                if world.entity(bench_id).is_none() {
                    Some(missing_entity(bench_id))
                } else if world.bench_run(run_id).is_none() {
                    Some(missing_run(bench_id))
                } else {
                    None
                }
            }

            Route::BenchChildRunDetail {
                bench_id,
                bench_run_id,
                child_run_id,
            } => {
                if world.entity(bench_id).is_none() {
                    Some(missing_entity(bench_id))
                } else if world.bench_run(bench_run_id).is_none() {
                    Some(missing_run(bench_id))
                } else if world.job_run(child_run_id).is_none() {
                    Some(Recovery {
                        route: Route::BenchRunDetail {
                            bench_id: bench_id.clone(),
                            run_id: bench_run_id.clone(),
                        },
                        message: Some("That dispatched run is no longer available.".to_owned()),
                    })
                } else {
                    None
                }
            }

            Route::ReportViewer { context, run_id } => {
                let entity_id = context.entity_id();
                if world.entity(entity_id).is_none() {
                    return Some(missing_entity(entity_id));
                }
                let run_exists = match context {
                    ReportContext::BenchRun { .. } => world.bench_run(run_id).is_some(),
                    _ => world.job_run(run_id).is_some(),
                };
                (!run_exists).then(|| missing_run(entity_id))
            }
        }
    }
}

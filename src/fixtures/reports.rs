//! Deterministic report bodies (specification §29).
//!
//! Generated rather than stored so the source stays small, and cached as
//! `Arc<str>` so many runs can share one body without copying it.

use std::collections::BTreeMap;
use std::sync::Arc;

use crate::model::ReportFormat;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum ReportKind {
    /// A short successful Job report.
    JobSuccess,
    /// A failed Job report.
    JobFailure,
    /// A Bench summary report.
    BenchSummary,
    /// Several hundred lines.
    Long,
    /// Very long lines that must not wrap unless the user asks.
    LongLines,
    /// Many repeated terms, for exercising report search.
    Searchable,

    // HTML reports. Each is deliberately styled differently: the application
    // does not control how an experiment writes its report, which is exactly
    // why HTML is handed to the browser rather than approximated in-app.
    /// A dark, chart-bearing HTML report.
    HtmlJobSuccess,
    /// A light, academic-looking HTML failure report.
    HtmlJobFailure,
    /// An HTML Bench summary, table-heavy.
    HtmlBenchSummary,
}

impl ReportKind {
    pub const ALL: [Self; 9] = [
        Self::JobSuccess,
        Self::JobFailure,
        Self::BenchSummary,
        Self::Long,
        Self::LongLines,
        Self::Searchable,
        Self::HtmlJobSuccess,
        Self::HtmlJobFailure,
        Self::HtmlBenchSummary,
    ];

    pub fn format(self) -> ReportFormat {
        match self {
            Self::HtmlJobSuccess | Self::HtmlJobFailure | Self::HtmlBenchSummary => {
                ReportFormat::Html
            }
            _ => ReportFormat::PlainText,
        }
    }
}

/// Report bodies, built once per backend.
#[derive(Clone, Debug, Default)]
pub struct ReportLibrary {
    bodies: BTreeMap<ReportKind, Arc<str>>,
}

impl ReportLibrary {
    pub fn new() -> Self {
        let bodies = ReportKind::ALL
            .into_iter()
            .map(|kind| (kind, Arc::from(build(kind))))
            .collect();
        Self { bodies }
    }

    pub fn get(&self, kind: ReportKind) -> Arc<str> {
        self.bodies
            .get(&kind)
            .cloned()
            .unwrap_or_else(|| Arc::from(""))
    }

    /// The report body paired with the format it should be presented in.
    pub fn state(&self, kind: ReportKind) -> crate::model::ReportState {
        crate::model::ReportState::available(kind.format(), self.get(kind))
    }
}

fn build(kind: ReportKind) -> String {
    match kind {
        ReportKind::JobSuccess => job_success(),
        ReportKind::JobFailure => job_failure(),
        ReportKind::BenchSummary => bench_summary(),
        ReportKind::Long => long(),
        ReportKind::LongLines => long_lines(),
        ReportKind::Searchable => searchable(),
        ReportKind::HtmlJobSuccess => html_job_success(),
        ReportKind::HtmlJobFailure => html_job_failure(),
        ReportKind::HtmlBenchSummary => html_bench_summary(),
    }
}

fn job_success() -> String {
    "\
EXPERIMENT REPORT
=================

Status        : SUCCEEDED
Mesh          : 256 x 256 x 256
Device        : gpu:0
Iterations    : 1240
Residual      : 4.81e-09
Wall time     : 00:06:18

Convergence
-----------
  iter    residual      delta
     0    1.00e+00          -
   200    3.42e-03   -2.46e+00
   400    7.19e-05   -3.86e+00
   600    2.03e-06   -3.57e+00
   800    1.17e-07   -2.85e+00
  1000    9.62e-09   -2.50e+00
  1240    4.81e-09   -6.93e-01

Artifacts
---------
  field.vtu          412 MB
  residuals.csv       88 KB
  summary.json         4 KB

No warnings were emitted.
"
    .to_owned()
}

fn job_failure() -> String {
    "\
EXPERIMENT REPORT
=================

Status        : FAILED
Mesh          : 1024 x 1024 x 1024
Device        : gpu:0
Iterations    : 87
Wall time     : 00:00:41

Failure
-------
The solver aborted while allocating the pressure field.

  requested : 38.2 GiB
  available : 23.6 GiB

The run reported a failed execution state. This is an execution failure, not a
query failure: the status below was read successfully.

Convergence before failure
--------------------------
  iter    residual
     0    1.00e+00
    40    8.83e-01
    80    8.79e-01

Residual stalled before the allocation failure. Consider reducing the mesh or
enabling out-of-core assembly.
"
    .to_owned()
}

fn bench_summary() -> String {
    "\
BENCH SUMMARY
=============

Bench         : Nightly Benchmark
Dispatched    : 6 runs
Succeeded     : 5
Failed        : 1
Cancelled     : 0
Wall time     : 00:11:04

The Bench dispatched every call at once. Calls are independent; the failure
below did not prevent any sibling from completing.

  call  job                parameters              status      duration
  ----  -----------------  ----------------------  ----------  --------
     1  Prepare Data       --dataset=nightly       Succeeded   00:01:12
     2  Build Solver       --release               Succeeded   00:03:45
     3  Generate Mesh      --resolution=fine       Succeeded   00:02:18
     4  Solver GPU         --mesh=256 --gpu=0      Succeeded   00:06:31
     5  Post Process       --all                   Failed      00:00:07
     6  Generate Report    --summary               Succeeded   00:00:44

Each row above is a real run of that Job and also appears in the Job's own run
history.
"
    .to_owned()
}

fn long() -> String {
    let mut out = String::with_capacity(48 * 1024);
    out.push_str("SOLVER TRACE\n============\n\n");
    for iter in 0..600 {
        let residual = 1.0_f64 / ((iter as f64) * (iter as f64) + 1.0);
        out.push_str(&format!(
            "[{iter:04}] residual={residual:.6e} dt=1.250e-03 cfl=0.48 \
             assembled=ok solved=ok wrote=checkpoint-{:04}\n",
            iter / 50
        ));
        if iter % 100 == 0 && iter > 0 {
            out.push_str(&format!("  -- checkpoint at iteration {iter} --\n"));
        }
    }
    out.push_str("\nTrace complete. 600 iterations recorded.\n");
    out
}

fn long_lines() -> String {
    let mut out = String::new();
    out.push_str("UNWRAPPED FIELD DUMP\n====================\n\n");
    out.push_str(
        "The lines below are intentionally far wider than any window. They must \
         not wrap unless the user turns wrapping on.\n\n",
    );
    for row in 0..40 {
        out.push_str(&format!("row {row:03} |"));
        for col in 0..120 {
            out.push_str(&format!(" {:+.6e}", (row * 120 + col) as f64 * 1.0e-4));
        }
        out.push('\n');
    }
    out
}

fn searchable() -> String {
    let mut out = String::new();
    out.push_str("DIAGNOSTIC LOG\n==============\n\n");
    for block in 0..60 {
        out.push_str(&format!(
            "[block {block:03}] convergence check: residual within tolerance\n"
        ));
        if block % 3 == 0 {
            out.push_str(&format!(
                "[block {block:03}] WARNING: convergence slowed, tolerance relaxed\n"
            ));
        }
        if block % 7 == 0 {
            out.push_str(&format!(
                "[block {block:03}] tolerance recomputed from convergence history\n"
            ));
        }
    }
    out.push_str(
        "\nThe words convergence, tolerance, and residual repeat throughout this \
         report so that search match counting has something to count.\n",
    );
    out
}

// ---------------------------------------------------------------- HTML bodies
//
// Three deliberately unrelated stylesheets. Nothing in this application knows or
// controls how an experiment styles its report, which is the whole reason HTML
// reports are opened in the system browser instead of approximated in-app.

fn html_job_success() -> String {
    let mut points = String::new();
    for i in 0..40 {
        let x = 20.0 + f64::from(i) * 16.0;
        let y = 180.0 - 160.0 / (1.0 + (-(f64::from(i) - 14.0) / 4.0).exp());
        points.push_str(&format!("{x:.1},{y:.1} "));
    }

    format!(
        r##"<!doctype html>
<meta charset="utf-8">
<title>Solver GPU — run report</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{ margin: 0; padding: 3rem; background: #0e1116; color: #d7dde5;
         font: 15px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }}
  h1 {{ font-size: 1.4rem; letter-spacing: .04em; color: #7ee2a8; margin: 0 0 .2rem; }}
  .sub {{ color: #6b7684; margin-bottom: 2.5rem; }}
  dl {{ display: grid; grid-template-columns: 12rem 1fr; gap: .35rem 1rem; margin: 0 0 2.5rem; }}
  dt {{ color: #6b7684; }}
  dd {{ margin: 0; }}
  .ok {{ color: #7ee2a8; }}
  figure {{ margin: 0 0 2.5rem; }}
  figcaption {{ color: #6b7684; font-size: .85rem; margin-top: .6rem; }}
  svg {{ background: #151a21; border: 1px solid #232a33; border-radius: 6px; }}
</style>

<h1>SUCCEEDED</h1>
<div class="sub">Solver GPU &middot; run report</div>

<dl>
  <dt>Mesh</dt><dd>256 &times; 256 &times; 256</dd>
  <dt>Device</dt><dd>gpu:0</dd>
  <dt>Iterations</dt><dd>1240</dd>
  <dt>Final residual</dt><dd class="ok">4.81e-09</dd>
  <dt>Wall time</dt><dd>00:06:18</dd>
</dl>

<figure>
  <svg width="680" height="200" viewBox="0 0 680 200">
    <polyline points="{points}" fill="none" stroke="#7ee2a8" stroke-width="2"/>
    <line x1="20" y1="180" x2="660" y2="180" stroke="#232a33"/>
  </svg>
  <figcaption>Residual convergence over 1240 iterations (log scale).</figcaption>
</figure>

<p>An inline SVG chart is exactly the kind of content an in-app text viewer
cannot show. The system browser renders it as the experiment intended.</p>
"##
    )
}

fn html_job_failure() -> String {
    r##"<!doctype html>
<meta charset="utf-8">
<title>Solver GPU — failure report</title>
<style>
  body { max-width: 46rem; margin: 4rem auto; padding: 0 1.5rem;
         font: 16px/1.7 Georgia, "Times New Roman", serif; color: #1c1c1c; }
  h1 { font-size: 1.6rem; font-weight: normal; border-bottom: 2px solid #b3271b;
       padding-bottom: .4rem; }
  .banner { background: #fdf0ee; border-left: 4px solid #b3271b;
            padding: 1rem 1.2rem; margin: 2rem 0; }
  table { border-collapse: collapse; width: 100%; margin: 2rem 0;
          font-family: ui-monospace, Menlo, monospace; font-size: .9rem; }
  th, td { border-bottom: 1px solid #ddd; padding: .45rem .6rem; text-align: left; }
  th { color: #666; font-weight: normal; }
  code { background: #f4f4f4; padding: .1rem .35rem; }
</style>

<h1>Execution failure</h1>

<div class="banner">
  <strong>The solver aborted while allocating the pressure field.</strong><br>
  Requested 38.2&nbsp;GiB, available 23.6&nbsp;GiB.
</div>

<p>This is an <em>execution</em> failure, not a query failure. The status was
read successfully; the experiment itself reported the failure.</p>

<table>
  <tr><th>iteration</th><th>residual</th><th>note</th></tr>
  <tr><td>0</td><td>1.00e+00</td><td></td></tr>
  <tr><td>40</td><td>8.83e-01</td><td>stalling</td></tr>
  <tr><td>80</td><td>8.79e-01</td><td>stalled</td></tr>
  <tr><td>87</td><td>—</td><td>allocation failed</td></tr>
</table>

<p>Consider reducing the mesh or enabling out-of-core assembly with
<code>--assembly=ooc</code>.</p>
"##
    .to_owned()
}

fn html_bench_summary() -> String {
    r##"<!doctype html>
<meta charset="utf-8">
<title>Nightly Benchmark — bench summary</title>
<style>
  body { margin: 0; padding: 2.5rem; background: #f7f8fa; color: #202430;
         font: 14px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1 { font-size: 1.25rem; margin: 0 0 .3rem; }
  .meta { color: #6a7280; margin-bottom: 2rem; }
  .cards { display: flex; gap: .75rem; margin-bottom: 2rem; flex-wrap: wrap; }
  .card { background: #fff; border: 1px solid #e3e6ec; border-radius: 8px;
          padding: .9rem 1.2rem; min-width: 7rem; }
  .card b { display: block; font-size: 1.5rem; font-weight: 600; }
  .card span { color: #6a7280; font-size: .8rem; }
  table { width: 100%; border-collapse: collapse; background: #fff;
          border: 1px solid #e3e6ec; border-radius: 8px; overflow: hidden; }
  th { background: #eef0f4; text-align: left; font-weight: 600; }
  th, td { padding: .55rem .8rem; border-bottom: 1px solid #eef0f4; }
  td.p { font-family: ui-monospace, Menlo, monospace; font-size: .85rem; color: #4a5162; }
  .s { color: #1b7f45; font-weight: 600; }
  .f { color: #b3271b; font-weight: 600; }
  .note { color: #6a7280; margin-top: 1.5rem; }
</style>

<h1>Nightly Benchmark</h1>
<div class="meta">Bench summary &middot; 6 runs dispatched at once</div>

<div class="cards">
  <div class="card"><b>5</b><span>succeeded</span></div>
  <div class="card"><b>1</b><span>failed</span></div>
  <div class="card"><b>0</b><span>cancelled</span></div>
  <div class="card"><b>00:11:04</b><span>wall time</span></div>
</div>

<table>
  <tr><th>Call</th><th>Job</th><th>Parameters</th><th>Status</th><th>Duration</th></tr>
  <tr><td>1</td><td>Prepare Data</td><td class="p">--dataset=nightly</td><td class="s">Succeeded</td><td>00:01:12</td></tr>
  <tr><td>2</td><td>Build Solver</td><td class="p">--release</td><td class="s">Succeeded</td><td>00:03:45</td></tr>
  <tr><td>3</td><td>Generate Mesh</td><td class="p">--resolution=fine</td><td class="s">Succeeded</td><td>00:02:18</td></tr>
  <tr><td>4</td><td>Solver GPU</td><td class="p">--mesh=256 --gpu=0</td><td class="s">Succeeded</td><td>00:06:31</td></tr>
  <tr><td>5</td><td>Post Process</td><td class="p">--all</td><td class="f">Failed</td><td>00:00:07</td></tr>
  <tr><td>6</td><td>Generate Report</td><td class="p">--summary</td><td class="s">Succeeded</td><td>00:00:44</td></tr>
</table>

<p class="note">Every row above is a real run of that Job and also appears in
that Job&rsquo;s own run history. The failure at call 5 did not stop any
sibling.</p>
"##
    .to_owned()
}

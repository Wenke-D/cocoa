//! The world the UI renders from, dumped as JSON and pinned to a golden file.
//!
//! Per-field assertions only cover the fields someone thought to assert. The
//! history indexes went empty for every run in the app without a single test
//! noticing, because every test read the run map instead. A golden file has no
//! such blind spot: anything that changes shape shows up as a diff.
//!
//! ```sh
//! UPDATE_GOLDEN=1 cargo test --test state_dump   # after an intended change
//! ```

#![cfg(unix)]

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use coco::adapter::{EngineAdapter, Experiments};
use coco::engine::Coco;
use serde_json::Value;
use tempfile::TempDir;

/// Copies the experiment folders only.
///
/// `runs/` and `report/` are state the mock scripts generate, and the repo's
/// own `mock/` carries whatever previous runs left behind. Copying that would
/// pin one machine's history into the golden file.
fn copy_experiments(src: &Path, dst: &Path) {
    fs::create_dir_all(dst).unwrap();
    for entry in fs::read_dir(src).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        if matches!(name.to_str(), Some("runs" | "report")) {
            continue;
        }
        let to = dst.join(&name);
        if entry.file_type().unwrap().is_dir() {
            copy_experiments(&entry.path(), &to);
        } else {
            fs::copy(entry.path(), &to).unwrap();
        }
    }
}

/// Replaces what a second run would legitimately print differently: the
/// library's temporary path, and every timestamp. Object keys are entity paths
/// and run ids, so they are normalized alongside the values.
fn normalize(value: Value, root: &str) -> Value {
    match value {
        Value::String(text) => Value::String(normalize_str(&text, root)),
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|item| normalize(item, root))
                .collect(),
        ),
        Value::Object(fields) => Value::Object(
            fields
                .into_iter()
                .map(|(key, item)| (normalize_str(&key, root), normalize(item, root)))
                .collect(),
        ),
        other => other,
    }
}

fn normalize_str(text: &str, root: &str) -> String {
    if chrono::DateTime::parse_from_rfc3339(text).is_ok() {
        return "<time>".to_owned();
    }
    match text.strip_prefix(root) {
        Some(rest) => format!("<library>{rest}"),
        None => text.to_owned(),
    }
}

#[test]
fn world_matches_the_golden_dump() {
    let dir = TempDir::new().unwrap();
    let library = dir.path().join("library");
    copy_experiments(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("mock"),
        &library,
    );

    let mut experiments = EngineAdapter::new(Coco::new(dir.path().join("store.json")).unwrap());
    experiments.register_folder(&library).unwrap();

    // One started run, so the golden file pins the history indexes too — the
    // part the UI reads and the run map cannot vouch for.
    let snapshot = experiments.snapshot();
    let solver = snapshot
        .entities
        .iter()
        .find(|entity| entity.name == "solver-gpu")
        .expect("the mock library registered")
        .id
        .clone();
    let parameters: BTreeMap<String, String> = [("nodes", "64"), ("gpu", "0")]
        .into_iter()
        .map(|(name, value)| (name.to_owned(), value.to_owned()))
        .collect();
    experiments.start(&solver, parameters).unwrap();

    let canonical = fs::canonicalize(&library).unwrap();
    let dump = serde_json::to_value(&*experiments.snapshot()).unwrap();
    let actual =
        serde_json::to_string_pretty(&normalize(dump, canonical.to_str().unwrap())).unwrap() + "\n";

    let golden = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden/world.json");
    if std::env::var("UPDATE_GOLDEN").is_ok() {
        fs::create_dir_all(golden.parent().unwrap()).unwrap();
        fs::write(&golden, &actual).unwrap();
        return;
    }

    let expected = fs::read_to_string(&golden)
        .expect("no golden file yet — create it with UPDATE_GOLDEN=1 cargo test --test state_dump");

    if actual != expected {
        panic!(
            "the world the UI renders from changed shape:\n\n{}\n\
             If that was intended: UPDATE_GOLDEN=1 cargo test --test state_dump",
            first_difference(&expected, &actual)
        );
    }
}

/// The first differing line with a little context.
///
/// `assert_eq!` on a multi-kilobyte JSON string prints two escaped blobs and
/// leaves the reader to spot the difference; the point of this test is to say
/// what changed.
fn first_difference(expected: &str, actual: &str) -> String {
    const CONTEXT: usize = 3;

    let expected: Vec<&str> = expected.lines().collect();
    let actual: Vec<&str> = actual.lines().collect();
    let mut out = String::new();

    for (index, (want, got)) in expected.iter().zip(&actual).enumerate() {
        if want == got {
            continue;
        }
        for line in &expected[index.saturating_sub(CONTEXT)..index] {
            out.push_str(&format!("   {line}\n"));
        }
        out.push_str(&format!("golden   {want}\nactual   {got}\n"));
        for line in expected.iter().skip(index + 1).take(CONTEXT) {
            out.push_str(&format!("   {line}\n"));
        }
        return out;
    }

    // Every shared line matches, so one dump simply has more of them.
    let (label, extra) = if actual.len() > expected.len() {
        ("actual has extra lines", &actual[expected.len()..])
    } else {
        (
            "golden has lines the actual dump lost",
            &expected[actual.len()..],
        )
    };
    out.push_str(&format!("{label}:\n"));
    for line in extra.iter().take(CONTEXT * 2) {
        out.push_str(&format!("   {line}\n"));
    }
    out
}

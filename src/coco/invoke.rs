//! Script invocation (convention §6, §7, §8).
//!
//! Every script runs with cwd = the entity folder, receives its arguments as
//! an argv list (never a shell command line), has stdout and stderr captured,
//! and is subject to a timeout after which it is killed.

use std::io::{self, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

/// The result of running one script.
#[derive(Clone, Debug)]
pub struct Invocation {
    pub exit: Option<i32>,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
}

impl Invocation {
    /// Whether the script "did its job" in the convention's sense: exited 0
    /// before the timeout.
    pub fn ok(&self) -> bool {
        !self.timed_out && self.exit == Some(0)
    }

    /// Captured stdout and stderr combined, for operation errors.
    pub fn output(&self) -> String {
        let out = self.stdout.trim_end();
        let err = self.stderr.trim_end();
        match (out.is_empty(), err.is_empty()) {
            (true, true) => String::new(),
            (false, true) => out.to_owned(),
            (true, false) => err.to_owned(),
            (false, false) => format!("{out}\n{err}"),
        }
    }
}

/// Runs `argv` with `cwd`, capturing output and enforcing `timeout`.
pub fn run(cwd: &Path, argv: &[String], timeout: Duration) -> io::Result<Invocation> {
    debug_assert!(!argv.is_empty(), "argv must name the script or interpreter");

    let mut child = Command::new(&argv[0])
        .args(&argv[1..])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let mut out = child.stdout.take().expect("stdout is piped");
    let mut err = child.stderr.take().expect("stderr is piped");
    let out_reader = thread::spawn(move || {
        let mut text = String::new();
        let _ = out.read_to_string(&mut text);
        text
    });
    let err_reader = thread::spawn(move || {
        let mut text = String::new();
        let _ = err.read_to_string(&mut text);
        text
    });

    let deadline = Instant::now() + timeout;
    let (exit, timed_out) = loop {
        match child.try_wait()? {
            Some(status) => break (status.code(), false),
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                break (None, true);
            }
            None => thread::sleep(Duration::from_millis(10)),
        }
    };

    let stdout = out_reader
        .join()
        .map_err(|_| io::Error::other("stdout reader panicked"))?;
    let stderr = err_reader
        .join()
        .map_err(|_| io::Error::other("stderr reader panicked"))?;

    Ok(Invocation {
        exit,
        timed_out,
        stdout,
        stderr,
    })
}

/// Every stdout line beginning with `COCO_RETURN: `, with the prefix and
/// surrounding whitespace removed. All other output is ignored, so scripts
/// may log freely (§6).
pub fn coco_return_lines(stdout: &str) -> Vec<&str> {
    stdout
        .lines()
        .filter_map(|line| line.strip_prefix("COCO_RETURN: "))
        .map(str::trim)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::coco_return_lines;

    #[test]
    fn extracts_contract_lines_only() {
        let lines = coco_return_lines(
            "submitting...\nCOCO_RETURN: 5001\nlog line\nCOCO_RETURN:  5002 extra\n",
        );
        assert_eq!(lines, ["5001", "5002 extra"]);
    }

    #[test]
    fn ignores_prefix_missing_space() {
        assert!(coco_return_lines("COCO_RETURN:5001\n").is_empty());
    }
}

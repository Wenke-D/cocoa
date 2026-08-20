//! Script invocation (convention §6, §7, §8).
//!
//! Every script runs with cwd = the entity folder, receives its arguments as
//! an argv list (never a shell command line), has stdout and stderr captured,
//! and is subject to a timeout after which it is killed.

use std::io::{self, Read};
use std::path::Path;
use std::process::{Child, Command, Stdio};
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

/// A script that has been started and not yet collected.
///
/// Holds the child and its output readers so a caller may do other work while
/// the script runs, checking in with [`Running::try_finish`]. Blocking is a
/// choice the caller makes (by looping), not one this module makes for it.
pub struct Running {
    child: Child,
    deadline: Instant,
    out_reader: Option<thread::JoinHandle<String>>,
    err_reader: Option<thread::JoinHandle<String>>,
}

/// Starts `argv` with `cwd`, capturing output. The timeout starts now; it is
/// enforced by [`Running::try_finish`], which kills the child at the deadline.
pub fn spawn(cwd: &Path, argv: &[String], timeout: Duration) -> io::Result<Running> {
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

    Ok(Running {
        child,
        deadline: Instant::now() + timeout,
        out_reader: Some(out_reader),
        err_reader: Some(err_reader),
    })
}

impl Running {
    /// Collects the script if it has finished, without waiting for it.
    ///
    /// Past the deadline the child is killed and the invocation comes back
    /// `timed_out`, exactly as the blocking [`run`] reports it. After
    /// `Ok(Some(_))` or `Err(_)` the script is spent; do not call again.
    pub fn try_finish(&mut self) -> io::Result<Option<Invocation>> {
        let (exit, timed_out) = match self.child.try_wait()? {
            Some(status) => (status.code(), false),
            None if Instant::now() >= self.deadline => {
                let _ = self.child.kill();
                let _ = self.child.wait();
                (None, true)
            }
            None => return Ok(None),
        };

        let stdout = self
            .out_reader
            .take()
            .expect("collected once")
            .join()
            .map_err(|_| io::Error::other("stdout reader panicked"))?;
        let stderr = self
            .err_reader
            .take()
            .expect("collected once")
            .join()
            .map_err(|_| io::Error::other("stderr reader panicked"))?;

        Ok(Some(Invocation {
            exit,
            timed_out,
            stdout,
            stderr,
        }))
    }

    /// Kills the script without collecting it. For shutdown: past this there
    /// is no output to read and no exit to interpret.
    pub fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Runs `argv` with `cwd`, capturing output and enforcing `timeout`. Blocks
/// until the script finishes or the deadline kills it.
pub fn run(cwd: &Path, argv: &[String], timeout: Duration) -> io::Result<Invocation> {
    let mut running = spawn(cwd, argv, timeout)?;
    loop {
        if let Some(invocation) = running.try_finish()? {
            return Ok(invocation);
        }
        thread::sleep(Duration::from_millis(10));
    }
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

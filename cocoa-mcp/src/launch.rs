//! Opening cocoa when it is not running (§43.1): the user's own window, on
//! their screen, started as the desktop starts it — never a hidden or
//! headless engine. The interface still exists only while that window runs;
//! this opens the window rather than working around it. It lives here because
//! the socket cannot answer for a cocoa that is not there.

use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::socket_client::{http, socket_dir, socket_path};

/// How long a cold start may take before the window is given up on: an
/// AppImage mounts itself before Electron even begins.
const READY_WITHIN: Duration = Duration::from_secs(30);

/// Starts cocoa unless it already answers, and waits until it does. The
/// sentence returned is the tool's answer either way.
pub(crate) fn launch() -> Result<String, String> {
    let socket = socket_path();
    if answering() {
        return Ok(format!(
            "cocoa is already running, answering on {}.",
            socket.display()
        ));
    }

    let mut command = app_command(profile_of(&socket));
    let shown = describe(&command);
    // Out of the agent's process group and off its pipes, so cocoa outlives
    // this server and nothing it prints lands in the JSON-RPC stream.
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        // Leaks in from an editor's terminal and turns Electron into Node.
        .env_remove("ELECTRON_RUN_AS_NODE");
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut command, 0);
    let mut child = command.spawn().map_err(|error| {
        format!(
            "could not start cocoa with `{shown}`: {error}. Set COCOA_APP to the \
             cocoa executable."
        )
    })?;

    let started = Instant::now();
    while started.elapsed() < READY_WITHIN {
        std::thread::sleep(Duration::from_millis(250));
        if answering() {
            return Ok(format!(
                "Started cocoa (`{shown}`); it is answering on {}. Its window is open on \
                 the user's screen.",
                socket.display()
            ));
        }
        // A clean exit is not a failure: a second launch hands over to the
        // cocoa already holding the profile, and macOS's `open` returns at once.
        if let Ok(Some(status)) = child.try_wait()
            && !status.success()
        {
            return Err(format!(
                "cocoa (`{shown}`) exited with {status} before it answered on {}.",
                socket.display()
            ));
        }
    }
    Err(format!(
        "started cocoa (`{shown}`), but it did not answer on {} within {} s.",
        socket.display(),
        READY_WITHIN.as_secs()
    ))
}

fn answering() -> bool {
    http("GET", "/help", None).is_ok()
}

/// The profile a socket belongs to, when it is one of the named sockets
/// beside the default one: `cocoa-<name>.sock` (§43.2). Any other path is
/// carried to cocoa by `COCOA_SOCKET_PATH`, which it inherits.
fn profile_of(socket: &Path) -> Option<String> {
    if socket.parent() != socket_dir().as_deref() {
        return None;
    }
    let name = socket
        .file_name()?
        .to_str()?
        .strip_prefix("cocoa-")?
        .strip_suffix(".sock")?;
    (!name.is_empty()).then(|| name.to_owned())
}

/// `COCOA_APP` when it is set; otherwise the installed app as the platform
/// starts it — `cocoa` on the `PATH`, or the app bundle on macOS.
fn app_command(profile: Option<String>) -> Command {
    let profile_args = profile.map_or_else(Vec::new, |name| vec!["--profile".to_owned(), name]);
    if let Ok(app) = std::env::var("COCOA_APP") {
        let mut command = Command::new(app);
        command.args(profile_args);
        return command;
    }
    if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.args(["-a", "cocoa"]);
        if !profile_args.is_empty() {
            command.arg("--args").args(profile_args);
        }
        return command;
    }
    let mut command = Command::new("cocoa");
    command.args(profile_args);
    command
}

fn describe(command: &Command) -> String {
    std::iter::once(command.get_program())
        .chain(command.get_args())
        .map(|part| part.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(" ")
}

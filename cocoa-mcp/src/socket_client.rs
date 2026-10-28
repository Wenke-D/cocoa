//! cocoa's Unix socket (§43.2), as a client sees it.

use std::path::{Path, PathBuf};
use std::time::Duration;

/// Where the socket lives — the same resolution cocoa's own server uses for
/// the default profile (§43.2); a named profile's is reached through
/// `COCOA_SOCKET_PATH`. Copied rather than imported: this crate must build
/// without the workbench it talks to.
pub(crate) fn socket_path() -> PathBuf {
    if let Ok(path) = std::env::var("COCOA_SOCKET_PATH") {
        return PathBuf::from(path);
    }
    socket_dir().map_or_else(|| PathBuf::from("cocoa.sock"), |dir| dir.join("cocoa.sock"))
}

/// The directory every profile's socket is in, when `HOME` says where that is.
pub(crate) fn socket_dir() -> Option<PathBuf> {
    std::env::var("HOME")
        .ok()
        .map(|home| PathBuf::from(home).join(".local/share/cocoa"))
}

/// One request, one response — libcurl over the Unix socket (§43.2), the
/// same dialect `curl --unix-socket` speaks by hand.
pub(crate) fn http(
    method: &str,
    path: &str,
    body: Option<String>,
) -> Result<(u16, String), String> {
    let socket = socket_path();
    perform(&socket, method, path, body).map_err(|error| {
        if error.is_couldnt_connect() {
            format!(
                "cocoa is not answering on {} ({error}); the interface exists only while \
                 the cocoa window is running. cocoa_launch opens it.",
                socket.display()
            )
        } else {
            error.to_string()
        }
    })
}

fn perform(
    socket: &Path,
    method: &str,
    path: &str,
    body: Option<String>,
) -> Result<(u16, String), curl::Error> {
    let mut easy = curl::easy::Easy::new();
    easy.unix_socket(&socket.to_string_lossy())?;
    // The host is never resolved over a Unix socket; the URL just needs one.
    easy.url(&format!("http://cocoa{path}"))?;
    easy.connect_timeout(Duration::from_secs(5))?;
    // Outlives the server's own 30-second engine wait (§43.3), so a slow
    // answer is still an answer and only a hang times out.
    easy.timeout(Duration::from_secs(60))?;
    if let Some(body) = &body {
        debug_assert_eq!(method, "POST");
        easy.post(true)?;
        easy.post_fields_copy(body.as_bytes())?;
        let mut headers = curl::easy::List::new();
        headers.append("Content-Type: application/json")?;
        easy.http_headers(headers)?;
    }

    let mut reply = Vec::new();
    {
        let mut transfer = easy.transfer();
        transfer.write_function(|data| {
            reply.extend_from_slice(data);
            Ok(data.len())
        })?;
        transfer.perform()?;
    }
    let status = easy.response_code()? as u16;
    Ok((status, String::from_utf8_lossy(&reply).into_owned()))
}

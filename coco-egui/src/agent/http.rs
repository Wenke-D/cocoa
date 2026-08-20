//! The boundary between the wire and the routes.
//!
//! An agent reaches coco the way the previous prototype was reached — by
//! curling an endpoint — so the wire format is HTTP even though the transport
//! is a Unix socket (`curl --unix-socket` speaks it). Speaking HTTP/1.1 itself
//! is `tiny_http`'s job; this module reduces what the library parsed to the two
//! shapes the routes actually read — a method, a path, a body — and turns a
//! route's answer back into a reply the library can send.

use std::io::Read;

/// The most a request body may be. A start's parameters are a handful of short
/// strings; anything at this size is a mistake or an attack, and reading it into
/// memory to find out is the mistake's accomplice.
const MAX_BODY: usize = 64 * 1024;

/// What a route reads: the parts of a request that decide anything.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Request {
    pub method: String,
    /// The path with any query string removed, percent-decoded.
    pub path: String,
    pub body: Vec<u8>,
}

impl Request {
    /// The path split on `/`, empty segments dropped.
    ///
    /// `/experiments/solver-gpu/runs` reads as `["experiments", "solver-gpu",
    /// "runs"]`, which is how the routes match.
    pub fn segments(&self) -> Vec<&str> {
        self.path
            .split('/')
            .filter(|part| !part.is_empty())
            .collect()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub body: String,
}

impl Response {
    pub fn json(status: u16, body: impl Into<String>) -> Self {
        Self {
            status,
            body: body.into(),
        }
    }

    /// A failure, in the one shape every failing reply takes.
    pub fn error(status: u16, message: impl std::fmt::Display) -> Self {
        Self::json(
            status,
            serde_json::json!({ "error": message.to_string() }).to_string(),
        )
    }
}

/// Reduces what `tiny_http` parsed to what the routes read. `Err` is a reply to
/// send, not a reason to drop the connection: a caller that got the shape wrong
/// deserves to be told.
pub fn receive(request: &mut tiny_http::Request) -> Result<Request, Response> {
    // Refused on the declared length, before reading a byte of it.
    if request.body_length().unwrap_or(0) > MAX_BODY {
        return Err(Response::error(413, "request body is too large"));
    }
    let mut body = Vec::new();
    let mut reader = request.as_reader().take(MAX_BODY as u64 + 1);
    if let Err(error) = reader.read_to_end(&mut body) {
        return Err(Response::error(400, error));
    }
    if body.len() > MAX_BODY {
        return Err(Response::error(413, "request body is too large"));
    }

    let method = request.method().as_str().to_owned();
    Ok(Request {
        method,
        path: path_of(request.url()),
        body,
    })
}

/// A route's answer, as the library sends it. `Content-Length` and the reason
/// phrase are the library's business.
pub fn send(response: Response) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let content_type: tiny_http::Header = "Content-Type: application/json"
        .parse()
        .expect("a literal header");
    tiny_http::Response::from_string(response.body)
        .with_status_code(response.status)
        .with_header(content_type)
}

/// The routable part of a request target: query string dropped, percent-escapes
/// resolved. Experiment names are folder names, and a folder name may hold a
/// space.
fn path_of(target: &str) -> String {
    let path = target.split(['?', '#']).next().unwrap_or(target);
    percent_decode(path)
}

fn percent_decode(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
            if let Some(byte) = hex.and_then(|hex| u8::from_str_radix(hex, 16).ok()) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_reads_as_its_segments() {
        let request = Request {
            method: "POST".to_owned(),
            path: "/experiments/solver-gpu/runs".to_owned(),
            body: Vec::new(),
        };
        assert_eq!(request.segments(), ["experiments", "solver-gpu", "runs"]);
    }

    /// A query string is not part of the route, and a percent-escaped name is
    /// the name.
    #[test]
    fn the_query_is_stripped_and_the_path_decoded() {
        assert_eq!(
            path_of("/experiments/my%20sweep?verbose=1"),
            "/experiments/my sweep"
        );
        assert_eq!(path_of("/world"), "/world");
    }
}

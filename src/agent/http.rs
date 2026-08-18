//! Just enough HTTP/1.1 to be curled.
//!
//! An agent reaches coco the way the previous prototype was reached — by
//! curling an endpoint — so the wire format is HTTP even though the transport
//! is a Unix socket (`curl --unix-socket` speaks it). What is actually needed
//! for a local control socket is one request, one response, connection closed:
//! no keep-alive, no chunked encoding, no TLS, no compression.
//!
//! That is small enough to write out, and writing it out is the honest trade
//! against a dependency (specification §5). Anything outside the subset is
//! answered `400` rather than guessed at.

use std::collections::BTreeMap;
use std::io::{self, BufRead, BufReader, Read, Write};

/// The most a request body may be. A start's parameters are a handful of short
/// strings; anything at this size is a mistake or an attack, and reading it into
/// memory to find out is the mistake's accomplice.
const MAX_BODY: usize = 64 * 1024;

/// The first line of a request line, and the headers we act on.
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

    fn reason(&self) -> &'static str {
        match self.status {
            200 => "OK",
            201 => "Created",
            400 => "Bad Request",
            404 => "Not Found",
            405 => "Method Not Allowed",
            409 => "Conflict",
            413 => "Payload Too Large",
            500 => "Internal Server Error",
            503 => "Service Unavailable",
            _ => "Unknown",
        }
    }

    pub fn write(&self, out: &mut impl Write) -> io::Result<()> {
        write!(
            out,
            "HTTP/1.1 {} {}\r\n\
             Content-Type: application/json\r\n\
             Content-Length: {}\r\n\
             Connection: close\r\n\
             \r\n",
            self.status,
            self.reason(),
            self.body.len()
        )?;
        out.write_all(self.body.as_bytes())?;
        out.flush()
    }
}

/// Reads one request. `Err` is a reply to send, not a reason to drop the
/// connection: a caller that got the shape wrong deserves to be told.
pub fn read_request(stream: &mut impl Read) -> Result<Request, Response> {
    let mut reader = BufReader::new(stream);

    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|error| Response::error(400, error))?;

    let mut parts = line.trim_end().split(' ');
    let (Some(method), Some(target), Some(version)) = (parts.next(), parts.next(), parts.next())
    else {
        return Err(Response::error(400, "malformed request line"));
    };
    if !version.starts_with("HTTP/1.") {
        return Err(Response::error(400, format!("unsupported {version}")));
    }

    let mut headers = BTreeMap::new();
    loop {
        let mut header = String::new();
        let read = reader
            .read_line(&mut header)
            .map_err(|error| Response::error(400, error))?;
        if read == 0 || header.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_owned());
        }
    }

    let length: usize = match headers.get("content-length") {
        Some(value) => value
            .parse()
            .map_err(|_| Response::error(400, "unreadable Content-Length"))?,
        None => 0,
    };
    if length > MAX_BODY {
        return Err(Response::error(413, "request body is too large"));
    }
    let mut body = vec![0; length];
    reader
        .read_exact(&mut body)
        .map_err(|error| Response::error(400, error))?;

    let path = target.split(['?', '#']).next().unwrap_or(target);
    Ok(Request {
        method: method.to_ascii_uppercase(),
        path: percent_decode(path),
        body,
    })
}

/// `%20` and friends. Experiment names are folder names, and a folder name may
/// hold a space.
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

    fn parse(raw: &str) -> Result<Request, Response> {
        read_request(&mut raw.as_bytes())
    }

    #[test]
    fn reads_a_get() {
        let request = parse("GET /world HTTP/1.1\r\nHost: coco\r\n\r\n").unwrap();
        assert_eq!(request.method, "GET");
        assert_eq!(request.path, "/world");
        assert!(request.body.is_empty());
        assert_eq!(request.segments(), ["world"]);
    }

    #[test]
    fn reads_a_post_with_a_body() {
        let request = parse(
            "POST /experiments/solver-gpu/runs HTTP/1.1\r\n\
             Content-Length: 9\r\n\r\n\
             {\"a\": 1}\n",
        )
        .unwrap();
        assert_eq!(request.segments(), ["experiments", "solver-gpu", "runs"]);
        assert_eq!(request.body, b"{\"a\": 1}\n");
    }

    /// A query string is not part of the route, and a percent-escaped name is
    /// the name.
    #[test]
    fn strips_the_query_and_decodes_the_path() {
        let request = parse("GET /experiments/my%20sweep?verbose=1 HTTP/1.1\r\n\r\n").unwrap();
        assert_eq!(request.segments(), ["experiments", "my sweep"]);
    }

    #[test]
    fn refuses_a_body_that_will_not_fit_in_memory() {
        let response = parse(&format!(
            "POST /x HTTP/1.1\r\nContent-Length: {}\r\n\r\n",
            MAX_BODY + 1
        ))
        .unwrap_err();
        assert_eq!(response.status, 413);
    }

    #[test]
    fn refuses_what_it_does_not_speak() {
        assert_eq!(parse("GARBAGE\r\n\r\n").unwrap_err().status, 400);
        assert_eq!(
            parse("GET / HTTP/2.0\r\n\r\n").unwrap_err().status,
            400,
            "a version we cannot answer is not guessed at"
        );
    }

    #[test]
    fn writes_a_response_curl_can_read() {
        let mut out = Vec::new();
        Response::json(201, "{\"run_id\":\"7\"}")
            .write(&mut out)
            .unwrap();
        let text = String::from_utf8(out).unwrap();
        assert!(text.starts_with("HTTP/1.1 201 Created\r\n"), "{text}");
        assert!(text.contains("Content-Length: 14\r\n"), "{text}");
        assert!(text.ends_with("\r\n\r\n{\"run_id\":\"7\"}"), "{text}");
    }
}

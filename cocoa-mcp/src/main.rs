//! `cocoa-mcp-server` — the agent interface (§43) as an MCP server.
//!
//! An agent's MCP client launches this binary and speaks JSON-RPC to it over
//! stdio; every tool call becomes one HTTP request over cocoa's Unix socket
//! (§43.2). Nothing is decided here: this is a translator, and the socket's
//! answers pass through verbatim, so an agent reading a refusal sees the same
//! sentence a person would have been shown.
//!
//! The MCP subset needed — initialize, tools/list, tools/call, one line of
//! JSON per message — is written out rather than taken as a dependency. HTTP
//! is the opposite call: libcurl speaks it (the `curl` crate), because a
//! hand-rolled HTTP client is code its reviewer would have to audit line by
//! line, and libcurl has been audited by the world instead. No TLS and no
//! async runtime — a private socket needs neither.
//!
//! It is its own crate, and knows nothing of the workbench but the socket
//! protocol of §43.2: whatever serves that protocol, it drives.

mod manual;
mod percent_encode;
mod rpc;
mod socket_client;
mod tools;

fn main() {
    if std::env::args().any(|argument| argument == "--help-ai") {
        print!("{}", manual::help_ai());
        return;
    }
    rpc::serve();
}

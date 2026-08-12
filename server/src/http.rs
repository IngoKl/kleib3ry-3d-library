//! Just enough HTTP/1.1 to serve one library to one household.
//!
//! No web framework, for the reason this project hand-rolls its collision and
//! reads ID3 tags without a crate: the whole surface is a dozen routes, a static
//! directory and byte ranges, and a dependency tree with a TLS stack and an
//! async runtime in it would be several hundred crates to avoid writing this
//! file. It also keeps the container to a static binary and a `dist/` folder.
//!
//! What it does *not* do, deliberately: TLS, chunked request bodies, HTTP/2,
//! keep-alive. A connection serves one request and closes, which costs a
//! handshake per asset and is invisible over a loopback or a LAN. If this ever
//! wants to be on the open internet it wants a reverse proxy in front of it,
//! which is what the compose file does.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;

/// A parsed request. The body is read eagerly, because every body this server
/// takes is a JSON document a few hundred kilobytes at worst.
///
/// There is no query string on it, because no route has one: everything the
/// front end asks for is named by its path, which is what makes the route table
/// readable next to `LibraryService`.
pub struct Request {
    pub method: String,
    /// Path only, already percent-decoded, with any query string discarded.
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(&name.to_ascii_lowercase()).map(|v| v.as_str())
    }
}

pub struct Response {
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
    pub extra: Vec<(String, String)>,
}

impl Response {
    pub fn new(status: u16, content_type: &str, body: Vec<u8>) -> Self {
        Self {
            status,
            content_type: content_type.to_string(),
            body,
            extra: Vec::new(),
        }
    }

    pub fn json(value: &serde_json::Value) -> Self {
        Self::new(200, "application/json; charset=utf-8", value.to_string().into_bytes())
    }

    pub fn text(status: u16, message: &str) -> Self {
        Self::new(status, "text/plain; charset=utf-8", message.as_bytes().to_vec())
    }

    pub fn empty(status: u16) -> Self {
        Self::new(status, "text/plain; charset=utf-8", Vec::new())
    }

    pub fn with(mut self, name: &str, value: &str) -> Self {
        self.extra.push((name.to_string(), value.to_string()));
        self
    }
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        206 => "Partial Content",
        304 => "Not Modified",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        416 => "Range Not Satisfiable",
        500 => "Internal Server Error",
        _ => "Unknown",
    }
}

/// Percent-decoding, which is the only part of a URL this needs to understand.
///
/// Bytes rather than characters, then `from_utf8_lossy`: a path is a sequence of
/// bytes on every filesystem that matters, and a `%C3%A4` in a filename has to
/// come back out as the two bytes it went in as.
pub fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        // A `+` is a space in a query string but a literal in a path. Paths are
        // the only thing here that carries a filename, so `+` is left alone.
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A body larger than this is refused. The biggest thing anybody legitimately
/// posts is a rendered cover as a base64 data URL, which is well under a
/// megabyte; the layout of a large library is a few hundred kilobytes.
const MAX_BODY: usize = 32 * 1024 * 1024;

pub fn read_request(stream: &TcpStream) -> Option<Request> {
    let mut reader = BufReader::new(stream);

    let mut line = String::new();
    if reader.read_line(&mut line).ok()? == 0 {
        return None;
    }
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();

    let mut headers = HashMap::new();
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).ok()? == 0 {
            break;
        }
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let length: usize = headers
        .get("content-length")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    if length > MAX_BODY {
        return None;
    }
    let mut body = vec![0u8; length];
    if length > 0 {
        reader.read_exact(&mut body).ok()?;
    }

    // Vite fingerprints its assets, so a cache-busting query can arrive on one;
    // the path is what identifies the file either way.
    let path = target.split('?').next().unwrap_or("");

    Some(Request {
        method,
        path: percent_decode(path),
        headers,
        body,
    })
}

pub fn write_response(mut stream: &TcpStream, response: Response) {
    let mut head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n",
        response.status,
        reason(response.status),
        response.content_type,
        response.body.len(),
    );
    for (name, value) in &response.extra {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");

    // A broken pipe is a browser that navigated away mid-download, which is
    // normal and not worth a line of log.
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&response.body);
    let _ = stream.flush();
}

/// A `Range: bytes=a-b` header, resolved against a known length.
///
/// This is what makes a tape seekable. Chromium will play a video served as a
/// plain 200, but dragging its position bar sends a range request and gives up
/// if it gets the whole file back — so a television with no seeking is exactly
/// what leaving this out looks like.
pub fn parse_range(header: &str, length: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    // Only a single range. Multipart ranges are legal and nothing asks for them.
    let (from, to) = spec.split_once('-')?;
    if from.is_empty() {
        // A suffix range: the last N bytes.
        let suffix: u64 = to.trim().parse().ok()?;
        if suffix == 0 || length == 0 {
            return None;
        }
        let start = length.saturating_sub(suffix);
        return Some((start, length - 1));
    }
    let start: u64 = from.trim().parse().ok()?;
    if start >= length {
        return None;
    }
    let end = if to.trim().is_empty() {
        length - 1
    } else {
        to.trim().parse::<u64>().ok()?.min(length - 1)
    };
    if end < start {
        return None;
    }
    Some((start, end))
}

/// Content type from a file extension. Only the types this app actually serves.
pub fn mime_of(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "pdf" => "application/pdf",
        "epub" => "application/epub+zip",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "ogv" => "video/ogg",
        "bcmap" => "application/octet-stream",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_escapes_come_back_as_bytes() {
        assert_eq!(percent_decode("/media/a%20b.pdf"), "/media/a b.pdf");
        assert_eq!(percent_decode("Bj%C3%B6rk"), "Björk");
        // A stray percent is data, not an escape, and must not eat the string.
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn a_range_resolves_against_the_length() {
        assert_eq!(parse_range("bytes=0-499", 1000), Some((0, 499)));
        // An open-ended range runs to the last byte.
        assert_eq!(parse_range("bytes=500-", 1000), Some((500, 999)));
        // A suffix range is the last N bytes, which is how a player reads an
        // MP4's moov atom when it is at the end of the file.
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        // Past the end is not satisfiable, and clamping would be a lie.
        assert_eq!(parse_range("bytes=1000-1200", 1000), None);
        // Over-long ends clamp, because that half is merely a hint.
        assert_eq!(parse_range("bytes=900-99999", 1000), Some((900, 999)));
        assert_eq!(parse_range("items=0-1", 1000), None);
    }

    #[test]
    fn media_types_cover_what_a_library_holds() {
        use std::path::Path;
        assert_eq!(mime_of(Path::new("a.pdf")), "application/pdf");
        assert_eq!(mime_of(Path::new("a.MP4")), "video/mp4");
        assert_eq!(mime_of(Path::new("a.flac")), "audio/flac");
        assert_eq!(mime_of(Path::new("a")), "application/octet-stream");
    }
}

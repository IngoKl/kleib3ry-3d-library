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
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};

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
    /// A body streamed straight from disk — `(file, offset, length)` — instead
    /// of `body`, so a multi-gigabyte tape is never held in memory. Chromium's
    /// opening move for a video is `Range: bytes=0-`, which is the whole file.
    pub file: Option<(std::fs::File, u64, u64)>,
    pub extra: Vec<(String, String)>,
}

impl Response {
    pub fn new(status: u16, content_type: &str, body: Vec<u8>) -> Self {
        Self {
            status,
            content_type: content_type.to_string(),
            body,
            file: None,
            extra: Vec::new(),
        }
    }

    /// `length` bytes of `file` starting at `offset`, read at write time.
    pub fn stream(
        status: u16,
        content_type: &str,
        file: std::fs::File,
        offset: u64,
        length: u64,
    ) -> Self {
        Self {
            status,
            content_type: content_type.to_string(),
            body: Vec::new(),
            file: Some((file, offset, length)),
            extra: Vec::new(),
        }
    }

    /// The bytes the client would receive, materialised for tests.
    #[cfg(test)]
    pub fn into_body_bytes(self) -> Vec<u8> {
        match self.file {
            None => self.body,
            Some((mut file, offset, length)) => {
                file.seek(SeekFrom::Start(offset)).unwrap();
                let mut bytes = vec![0u8; length as usize];
                file.read_exact(&mut bytes).unwrap();
                bytes
            }
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
        409 => "Conflict",
        411 => "Length Required",
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

/// Limits that make a hostile client boring: no browser sends a header line
/// this long or this many headers. The third limit — a read timeout, so a
/// drip-fed request cannot pin a thread forever — is set where the connection
/// is accepted, because it belongs to the socket rather than to the parse.
const MAX_HEADER_LINE: usize = 8 * 1024;
const MAX_HEADERS: usize = 100;

/// One line, with `read_line`'s unbounded append capped through `take`.
/// `None` is an I/O error or a line over the cap; EOF is an empty string.
fn bounded_line<R: Read>(reader: &mut BufReader<R>) -> Option<String> {
    let mut line = String::new();
    (&mut *reader).take(MAX_HEADER_LINE as u64 + 1).read_line(&mut line).ok()?;
    (line.len() <= MAX_HEADER_LINE).then_some(line)
}

/// A parsed request, or the status code to refuse the connection with.
pub fn read_request<R: Read>(stream: R) -> std::result::Result<Request, u16> {
    let mut reader = BufReader::new(stream);

    let line = bounded_line(&mut reader).ok_or(400u16)?;
    let mut parts = line.split_whitespace();
    let method = parts.next().ok_or(400u16)?.to_string();
    let target = parts.next().ok_or(400u16)?.to_string();

    let mut headers = HashMap::new();
    loop {
        let line = bounded_line(&mut reader).ok_or(400u16)?;
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if headers.len() >= MAX_HEADERS {
            return Err(400);
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    // A chunked body would read as empty below, and an "empty" POST /api/world
    // would trip the write-once guard against the real document forever. This
    // server reads Content-Length bodies only, so anything else is refused.
    if let Some(encoding) = headers.get("transfer-encoding") {
        if !encoding.eq_ignore_ascii_case("identity") {
            return Err(411);
        }
    }

    let length: usize = headers
        .get("content-length")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    if length > MAX_BODY {
        return Err(413);
    }
    let mut body = vec![0u8; length];
    if length > 0 {
        reader.read_exact(&mut body).map_err(|_| 400u16)?;
    }

    // Vite fingerprints its assets, so a cache-busting query can arrive on one;
    // the path is what identifies the file either way.
    let path = target.split('?').next().unwrap_or("");

    Ok(Request {
        method,
        path: percent_decode(path),
        headers,
        body,
    })
}

pub fn write_response<W: Write>(stream: W, response: Response) {
    write(stream, response, true)
}

/// The same status line and headers `write_response` would send — including
/// the full Content-Length — with no body. What HEAD promises.
pub fn write_head<W: Write>(stream: W, response: Response) {
    write(stream, response, false)
}

fn write<W: Write>(mut stream: W, response: Response, include_body: bool) {
    let content_length = match &response.file {
        Some((_, _, length)) => *length,
        None => response.body.len() as u64,
    };
    let mut head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n",
        response.status,
        reason(response.status),
        response.content_type,
        content_length,
    );
    for (name, value) in &response.extra {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");

    // A broken pipe is a browser that navigated away mid-download, which is
    // normal and not worth a line of log.
    if stream.write_all(head.as_bytes()).is_err() {
        return;
    }
    if include_body {
        match response.file {
            Some((mut file, offset, mut remaining)) => {
                // Chunked from the open file, so the span is never in memory.
                if file.seek(SeekFrom::Start(offset)).is_err() {
                    return;
                }
                let mut chunk = [0u8; 64 * 1024];
                while remaining > 0 {
                    let want = chunk.len().min(remaining as usize);
                    match file.read(&mut chunk[..want]) {
                        // The file shrank underneath us; a short body is all
                        // that can honestly be sent.
                        Ok(0) => break,
                        Ok(n) => {
                            if stream.write_all(&chunk[..n]).is_err() {
                                return;
                            }
                            remaining -= n as u64;
                        }
                        Err(_) => return,
                    }
                }
            }
            None => {
                if stream.write_all(&response.body).is_err() {
                    return;
                }
            }
        }
    }
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
    fn a_request_parses_with_its_headers_and_body() {
        let raw = b"POST /api/layout?v=1 HTTP/1.1\r\nContent-Length: 4\r\nX-Thing: yes\r\n\r\nbody";
        let request = read_request(&raw[..]).unwrap();
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/api/layout");
        assert_eq!(request.body, b"body".to_vec());
        assert_eq!(request.header("X-Thing"), Some("yes"));
    }

    #[test]
    fn an_oversized_header_line_is_refused() {
        // `read_line` appends without limit, so the cap is what stands between
        // a hostile client and unbounded memory.
        let raw = format!("GET /{} HTTP/1.1\r\n\r\n", "a".repeat(9_000));
        assert_eq!(read_request(raw.as_bytes()).err(), Some(400));

        let raw = format!("GET / HTTP/1.1\r\nX-Big: {}\r\n\r\n", "b".repeat(9_000));
        assert_eq!(read_request(raw.as_bytes()).err(), Some(400));
    }

    #[test]
    fn too_many_headers_are_refused() {
        let mut raw = String::from("GET / HTTP/1.1\r\n");
        for i in 0..150 {
            raw.push_str(&format!("x-h-{i}: v\r\n"));
        }
        raw.push_str("\r\n");
        assert_eq!(read_request(raw.as_bytes()).err(), Some(400));
    }

    #[test]
    fn a_chunked_body_is_refused_rather_than_read_as_empty() {
        // Reading it as empty once wrote an empty world document whose
        // write-once guard then blocked the real one forever.
        let raw = b"POST /api/world HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nbody\r\n0\r\n\r\n";
        assert_eq!(read_request(&raw[..]).err(), Some(411));

        // `identity` is the one encoding that means "no encoding".
        let plain = b"POST /api/world HTTP/1.1\r\nTransfer-Encoding: identity\r\nContent-Length: 2\r\n\r\n{}";
        assert_eq!(read_request(&plain[..]).unwrap().body, b"{}".to_vec());
    }

    #[test]
    fn head_writes_the_same_head_and_no_body() {
        let mut out = Vec::new();
        write_head(&mut out, Response::new(200, "text/plain", b"hello".to_vec()));
        let text = String::from_utf8(out).unwrap();
        assert!(text.contains("Content-Length: 5"), "{text}");
        assert!(text.ends_with("\r\n\r\n"), "a HEAD answer carried a body: {text}");
    }

    #[test]
    fn a_streamed_file_range_goes_out_in_chunks_with_the_full_length_advertised() {
        let path = std::env::temp_dir().join("kleib3ry-http-stream.bin");
        std::fs::write(&path, b"0123456789").unwrap();
        let file = std::fs::File::open(&path).unwrap();

        let mut out = Vec::new();
        write_response(&mut out, Response::stream(206, "video/mp4", file, 2, 4));
        let text = String::from_utf8_lossy(&out);
        assert!(text.contains("Content-Length: 4"), "{text}");
        assert!(out.ends_with(b"2345"), "wrong bytes streamed");

        let _ = std::fs::remove_file(&path);
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

//! kleib3ry over HTTP — what `httpDriver` talks to.
//!
//! Every route answers exactly one `LibraryService` method, in the order they
//! are declared in `src/services/types.ts`, so the two files read side by side.
//!
//! Two things the desktop shell does not do: serve the built front end, so the
//! container is one process; and serve media by path under `/media/`. Tauri's
//! asset scope covers the latter on the desktop, so `is_allowed` is the one
//! piece of security here.
//!
//!     kleib3ry-server --root /library --dist /app/dist --port 8080

mod http;

use std::fs;
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use kleib3ry_core::{catalog::Catalog, index, media, paper, save_files, stamp_of, write_atomic};
use serde_json::json;

use http::{Request, Response};

struct Config {
    root: PathBuf,
    dist: PathBuf,
}

/// What a scan is doing. Polled rather than pushed: a websocket for one number
/// would be a second protocol to keep working.
#[derive(Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    done: u32,
    total: u32,
    current: String,
    running: bool,
}

struct State {
    config: Config,
    progress: Mutex<Progress>,
    /// Non-zero while a scan runs, so a second is refused rather than
    /// duplicating the first's work and overwriting its index.
    scanning: AtomicU32,
}

fn main() -> std::process::ExitCode {
    let mut root: Option<PathBuf> = None;
    let mut dist = PathBuf::from("dist");
    let mut port = 8080u16;
    let mut bind = "0.0.0.0".to_string();

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--root" => root = args.next().map(PathBuf::from),
            "--dist" => {
                if let Some(value) = args.next() {
                    dist = PathBuf::from(value)
                }
            }
            "--port" => {
                if let Some(value) = args.next() {
                    match value.parse() {
                        Ok(parsed) => port = parsed,
                        Err(_) => {
                            eprintln!("not a port: {value}");
                            return std::process::ExitCode::from(2);
                        }
                    }
                }
            }
            "--bind" => {
                if let Some(value) = args.next() {
                    bind = value
                }
            }
            "--help" | "-h" => {
                eprintln!("usage: kleib3ry-server --root <library folder> [--dist dist] [--port 8080] [--bind 0.0.0.0]");
                return std::process::ExitCode::SUCCESS;
            }
            other => {
                eprintln!("unknown option {other}");
                return std::process::ExitCode::from(2);
            }
        }
    }

    // Environment first, flags win — so compose files and shells both work.
    let root = root
        .or_else(|| std::env::var_os("KLEIB3RY_LIBRARY").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("/library"));

    if !root.is_dir() {
        eprintln!("not a directory: {}", root.display());
        eprintln!("mount your library folder there, or pass --root");
        return std::process::ExitCode::FAILURE;
    }
    // Canonicalised once at startup: every path check compares against it, and
    // a symlinked mount point would fail those checks for legitimate files.
    let root = root.canonicalize().unwrap_or(root);

    let files = save_files(&root);
    if let Err(e) = fs::create_dir_all(&files.covers) {
        eprintln!("cannot write to {}: {e}", files.covers.display());
        return std::process::ExitCode::FAILURE;
    }

    let listener = match TcpListener::bind((bind.as_str(), port)) {
        Ok(listener) => listener,
        Err(e) => {
            eprintln!("cannot listen on {bind}:{port} — {e}");
            return std::process::ExitCode::FAILURE;
        }
    };

    println!("kleib3ry");
    println!("  library  {}", root.display());
    println!("  index    {}", files.index.display());
    println!("  front end {}", dist.display());
    println!("  listening on http://{bind}:{port}");
    if !dist.is_dir() {
        println!("  (no front end at that path — the API still answers)");
    }

    let state = Arc::new(State {
        config: Config { root, dist },
        progress: Mutex::new(Progress::default()),
        scanning: AtomicU32::new(0),
    });

    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        // A client that connects and then stalls must release its thread.
        let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(30)));
        let state = Arc::clone(&state);
        // A thread per connection: household scale, and a book being read must
        // not block a track being streamed.
        std::thread::spawn(move || serve(stream, &state));
    }

    std::process::ExitCode::SUCCESS
}

fn serve(stream: TcpStream, state: &State) {
    let mut request = match http::read_request(&stream) {
        Ok(request) => request,
        Err(status) => {
            http::write_response(&stream, Response::empty(status));
            return;
        }
    };
    // HEAD is GET without the body: routed identically so the headers agree,
    // then only the head is written.
    let is_head = request.method == "HEAD";
    if is_head {
        request.method = "GET".to_string();
    }
    let response = route(&request, state).unwrap_or_else(|message| Response::text(500, &message));
    if is_head {
        http::write_head(&stream, response);
    } else {
        http::write_response(&stream, response);
    }
}

/// Errors are strings: they go straight into the HUD's error line, and the
/// front end cannot act differently on a missing file than a corrupt one.
type Handler = std::result::Result<Response, String>;

fn oops<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// The progress lock, poison-proof: a thread that panicked while holding it
/// must not take the progress poll — or the next scan — down with it.
fn progress_of(state: &State) -> MutexGuard<'_, Progress> {
    state.progress.lock().unwrap_or_else(|e| e.into_inner())
}

fn route(request: &Request, state: &State) -> Handler {
    let path = request.path.as_str();
    let method = request.method.as_str();
    let files = save_files(&state.config.root);

    match (method, path) {
        // ---- where the library is -------------------------------------------
        // The root is the mount, not a choice: a picker would let the browser
        // walk the server's disk, so `canPickFolder` is false here.
        ("GET", "/api/root") => Ok(Response::json(&json!({
            "root": state.config.root.to_string_lossy(),
        }))),

        // ---- books -----------------------------------------------------------
        ("GET", "/api/books") => {
            let catalog = Catalog::load(&files.index).map_err(oops)?;
            let books = catalog.list_books(&state.config.root, &files.covers);
            // Absolute paths, as the desktop app returns; the driver turns them
            // into `/media/...` URLs.
            let with_covers: Vec<_> = books
                .into_iter()
                .map(|mut book| {
                    if let Some(name) = &book.cover {
                        book.cover = Some(files.covers.join(name).to_string_lossy().to_string());
                    }
                    book
                })
                .collect();
            Ok(Response::json(&serde_json::to_value(with_covers).map_err(oops)?))
        }

        // The one route that reaches outside the container, through the same
        // core function the desktop app calls. See `core/src/paper.rs`.
        ("POST", "/api/paper") => {
            let id = std::str::from_utf8(&request.body).unwrap_or("").trim().to_string();
            match paper::fetch(&state.config.root, &files.index, &files.covers, &id) {
                Ok(mut book) => {
                    if let Some(name) = &book.cover {
                        book.cover = Some(files.covers.join(name).to_string_lossy().to_string());
                    }
                    Ok(Response::json(&serde_json::to_value(book).map_err(oops)?))
                }
                // A bad id and an unknown paper have different fixes, so the
                // message distinguishes them.
                Err(e @ (kleib3ry_core::Error::BadPaperId(_) | kleib3ry_core::Error::UnknownPaper(_))) => {
                    Ok(Response::text(404, &e.to_string()))
                }
                Err(e) => Ok(Response::text(502, &e.to_string())),
            }
        }

        ("POST", "/api/scan") => {
            // One at a time: concurrent scans duplicate work and overwrite each
            // other's index.
            if state.scanning.swap(1, Ordering::SeqCst) == 1 {
                return Ok(Response::text(409, "a scan is already running"));
            }
            // A drop guard, so a panic escaping `index::scan` cannot leave the
            // flag set and every later scan answering 409.
            struct Reset<'a>(&'a State);
            impl Drop for Reset<'_> {
                fn drop(&mut self) {
                    progress_of(self.0).running = false;
                    self.0.scanning.store(0, Ordering::SeqCst);
                }
            }
            let _reset = Reset(state);

            *progress_of(state) = Progress { running: true, ..Default::default() };

            let outcome = index::scan(
                &state.config.root,
                &files.index,
                &files.covers,
                |update| {
                    let mut progress = progress_of(state);
                    progress.done = update.done;
                    progress.total = update.total;
                    progress.current = update.current;
                    progress.running = true;
                },
            );

            let summary = outcome.map_err(oops)?;
            Ok(Response::json(&serde_json::to_value(summary).map_err(oops)?))
        }

        ("GET", "/api/scan/progress") => {
            let progress = progress_of(state).clone();
            Ok(Response::json(&serde_json::to_value(progress).map_err(oops)?))
        }

        // ---- the world document, as text ------------------------------------
        ("GET", "/api/world") => match fs::read_to_string(&files.world) {
            Ok(text) => Ok(Response::new(200, "text/plain; charset=utf-8", text.into_bytes())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Response::empty(404)),
            Err(e) => Err(oops(e)),
        },

        // Refuses to overwrite: called on first run, and a race here would
        // replace a room somebody built.
        ("POST", "/api/world") => {
            if files.world.exists() {
                return Ok(Response::json(&json!({ "written": false })));
            }
            if let Some(parent) = files.world.parent() {
                fs::create_dir_all(parent).map_err(oops)?;
            }
            fs::write(&files.world, &request.body).map_err(oops)?;
            Ok(Response::json(&json!({ "written": true })))
        }

        ("GET", "/api/world/stamp") => Ok(Response::json(&json!({
            "stamp": stamp_of(&files.world),
        }))),

        ("GET", "/api/paths") => Ok(Response::json(&json!({
            "world": files.world.to_string_lossy(),
            "layout": files.layout.to_string_lossy(),
            "annotations": files.annotations.to_string_lossy(),
        }))),

        // ---- the layout, opaque and owned by the front end -------------------
        ("GET", "/api/layout") => match fs::read_to_string(&files.layout) {
            Ok(text) => Ok(Response::new(200, "application/json; charset=utf-8", text.into_bytes())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Response::empty(404)),
            Err(e) => Err(oops(e)),
        },

        ("PUT", "/api/layout") => {
            write_json_file(&files.layout, &request.body)?;
            Ok(Response::empty(204))
        }

        // The room's ambience: the lamps and the weather, in one file.
        ("GET", "/api/ambience") => match fs::read_to_string(&files.ambience) {
            Ok(text) => Ok(Response::new(200, "application/json; charset=utf-8", text.into_bytes())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Response::empty(404)),
            Err(e) => Err(oops(e)),
        },

        ("PUT", "/api/ambience") => {
            write_json_file(&files.ambience, &request.body)?;
            Ok(Response::empty(204))
        }

        // Bookmarks and notes. Its own file so they are readable without the
        // app; the schema is the front end's, like the layout.
        ("GET", "/api/annotations") => match fs::read_to_string(&files.annotations) {
            Ok(text) => Ok(Response::new(200, "application/json; charset=utf-8", text.into_bytes())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Response::empty(404)),
            Err(e) => Err(oops(e)),
        },

        ("PUT", "/api/annotations") => {
            write_json_file(&files.annotations, &request.body)?;
            Ok(Response::empty(204))
        }

        // ---- the other three folders -----------------------------------------
        ("GET", "/api/music") => Ok(Response::json(
            &serde_json::to_value(media::list_tracks(&state.config.root)).map_err(oops)?,
        )),
        ("GET", "/api/artwork") => Ok(Response::json(
            &serde_json::to_value(media::list_artwork(&state.config.root)).map_err(oops)?,
        )),
        ("GET", "/api/video") => Ok(Response::json(
            &serde_json::to_value(media::list_videos(&state.config.root)).map_err(oops)?,
        )),
        ("GET", "/api/roms") => Ok(Response::json(
            &serde_json::to_value(media::list_roms(&state.config.root)).map_err(oops)?,
        )),

        _ => route_by_prefix(request, state),
    }
}

fn route_by_prefix(request: &Request, state: &State) -> Handler {
    let path = request.path.as_str();
    let method = request.method.as_str();
    let files = save_files(&state.config.root);

    // A book's bytes, for pdf.js. Read and answered whole, like the desktop
    // `read_book_file`: the reader parses in one go, so a range saves nothing.
    if method == "GET" {
        if let Some(id) = path.strip_prefix("/api/book/") {
            let catalog = Catalog::load(&files.index).map_err(oops)?;
            let Some(book) = catalog.path_of(&state.config.root, id) else {
                return Ok(Response::text(404, "no such book"))
            };
            let bytes = fs::read(&book).map_err(oops)?;
            return Ok(Response::new(200, "application/octet-stream", bytes));
        }

        // A ROM's bytes, for the arcade machine's emulator — by listing id, not
        // by name, so `roms/` never needs to join the `/media/` allow-list.
        if let Some(id) = path.strip_prefix("/api/rom/") {
            let Some(rom) = media::rom_path(&state.config.root, id) else {
                return Ok(Response::text(404, "no such rom"))
            };
            let bytes = fs::read(&rom).map_err(oops)?;
            return Ok(Response::new(200, "application/octet-stream", bytes));
        }
    }

    // A cover the front end rasterised with pdf.js, cached like any other.
    if method == "POST" {
        if let Some(id) = path.strip_prefix("/api/cover/") {
            return save_cover(id, &request.body, &files);
        }
    }

    if method == "GET" && path.starts_with("/media/") {
        return serve_media(request, state);
    }

    if method == "GET" {
        return serve_static(request, state);
    }

    Ok(Response::text(405, "method not allowed"))
}

fn write_json_file(path: &Path, body: &[u8]) -> std::result::Result<(), String> {
    // Parsed before writing, so a truncated PUT cannot leave a layout the next
    // load refuses. Written atomically against a crash mid-write.
    let value: serde_json::Value = serde_json::from_slice(body).map_err(oops)?;
    write_atomic(path, serde_json::to_string_pretty(&value).map_err(oops)?.as_bytes())
        .map_err(oops)
}

fn save_cover(id: &str, body: &[u8], files: &kleib3ry_core::SaveFiles) -> Handler {
    // The id becomes a file name and arrives from a browser; the guard is in
    // core because the desktop shell writes covers through it too.
    if !kleib3ry_core::catalog::is_cover_id(id) {
        return Ok(Response::text(400, "not a cover id"));
    }
    // Only a book the index knows may have a cover cached; anything else fills
    // the disk with orphan PNGs one POST at a time.
    if !Catalog::load(&files.index).map_err(oops)?.contains(id) {
        return Ok(Response::text(404, "no such book"));
    }
    let text = std::str::from_utf8(body).map_err(oops)?;
    let payload = text
        .split_once(";base64,")
        .map(|(_, rest)| rest)
        .ok_or("expected a base64 data URL")?;
    let bytes = decode_base64(payload).ok_or("not valid base64")?;

    // The file is the record: listing derives a book's cover from the cache, so
    // the scan stays the index's only writer.
    let name = format!("{id}.png");
    fs::create_dir_all(&files.covers).map_err(oops)?;
    fs::write(files.covers.join(&name), &bytes).map_err(oops)?;

    Ok(Response::json(&json!({
        "path": files.covers.join(&name).to_string_lossy(),
    })))
}

/// Standard base64, no line breaks, `=` padding. Hand-rolled rather than a
/// dependency; only our own front end posts to it.
fn decode_base64(text: &str) -> Option<Vec<u8>> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut lookup = [255u8; 256];
    for (i, c) in TABLE.iter().enumerate() {
        lookup[*c as usize] = i as u8;
    }

    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for byte in text.bytes() {
        if byte == b'=' || byte.is_ascii_whitespace() {
            continue;
        }
        let value = lookup[byte as usize];
        if value == 255 {
            return None;
        }
        buffer = (buffer << 6) | value as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
    }
    Some(out)
}

/// The four directories the front end may read, matching the desktop app's asset
/// scope. `books/` is deliberately not among them: a book goes through
/// `/api/book/<id>`, so a browser can only name what the index gave it.
fn media_roots(root: &Path) -> Vec<PathBuf> {
    let files = save_files(root);
    vec![
        files.covers,
        root.join(media::MUSIC_DIR),
        root.join(media::ARTWORK_DIR),
        root.join(media::VIDEO_DIR),
    ]
}

/// True if `path` really is inside one of the servable directories. Canonicalised
/// first, so `..`, a planted symlink and a Windows short name all resolve away;
/// a path that cannot be canonicalised does not exist, and is refused.
fn is_allowed(path: &Path, root: &Path) -> bool {
    let Ok(real) = path.canonicalize() else { return false };
    if !real.is_file() {
        return false;
    }
    media_roots(root).iter().any(|allowed| {
        allowed
            .canonicalize()
            .map(|base| real.starts_with(base))
            .unwrap_or(false)
    })
}

fn serve_media(request: &Request, state: &State) -> Handler {
    let raw = request.path.trim_start_matches("/media/");
    // The driver sends an absolute server-side path, because that is what the
    // index hands it; a second naming scheme could disagree with the first.
    let wanted = PathBuf::from(raw);
    let wanted = if wanted.is_absolute() {
        wanted
    } else {
        // A relative path is read against the library folder, which is what a
        // hand-written URL will look like.
        state.config.root.join(wanted)
    };

    if !is_allowed(&wanted, &state.config.root) {
        // Deliberately the same answer for "outside the library" and "not
        // there": a 403 on one and a 404 on the other is a directory oracle.
        return Ok(Response::text(404, "not found"));
    }

    let file = fs::File::open(&wanted).map_err(oops)?;
    let length = file.metadata().map_err(oops)?.len();
    let mime = http::mime_of(&wanted);

    // What makes a tape seekable. Streamed from the open file rather than
    // buffered: Chromium opens a video with `Range: bytes=0-`.
    if let Some(header) = request.header("range") {
        return match http::parse_range(header, length) {
            Some((start, end)) => Ok(Response::stream(206, mime, file, start, end - start + 1)
                .with("Content-Range", &format!("bytes {start}-{end}/{length}"))
                .with("Accept-Ranges", "bytes")),
            None => Ok(Response::empty(416).with("Content-Range", &format!("bytes */{length}"))),
        };
    }

    Ok(Response::stream(200, mime, file, 0, length).with("Accept-Ranges", "bytes"))
}

/// The built front end. A single-page app, so a non-file falls back to
/// `index.html`; the path is resolved component by component with `..` refused
/// rather than canonicalised, since a missing `dist/` means "no front end".
fn serve_static(request: &Request, state: &State) -> Handler {
    let relative = request.path.trim_start_matches('/');
    let mut safe = PathBuf::new();
    for part in Path::new(relative).components() {
        match part {
            Component::Normal(name) => safe.push(name),
            // Any of these in a URL is either an attack or a bug; neither is
            // something to guess the intent of.
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Ok(Response::text(404, "not found"))
            }
            Component::CurDir => {}
        }
    }

    let candidate = state.config.dist.join(&safe);
    if safe.as_os_str().is_empty() || !candidate.is_file() {
        let index = state.config.dist.join("index.html");
        return match fs::read(&index) {
            Ok(bytes) => Ok(Response::new(200, "text/html; charset=utf-8", bytes)),
            Err(_) => Ok(Response::text(
                404,
                "no front end here. Build it with `npm run build:http` and point --dist at dist/",
            )),
        };
    }

    let bytes = fs::read(&candidate).map_err(oops)?;
    Ok(Response::new(200, http::mime_of(&candidate), bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kleib3ry-server-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("music")).unwrap();
        fs::create_dir_all(dir.join("books")).unwrap();
        fs::create_dir_all(save_files(&dir).covers).unwrap();
        // Canonicalised, because `is_allowed` canonicalises what it is given and
        // the temp directory is a symlink on some machines.
        dir.canonicalize().unwrap_or(dir)
    }

    /// The routing table, driven directly. `route` is a pure function of a
    /// request and a folder, so no port is bound; that leaves only `http.rs`'s
    /// parsing, which has its own tests, and the four-line accept loop.
    struct Harness {
        root: PathBuf,
        state: State,
    }

    impl Harness {
        fn new(name: &str) -> Self {
            let root = temp_root(name);
            Self {
                state: State {
                    config: Config { root: root.clone(), dist: root.join("no-dist") },
                    progress: Mutex::new(Progress::default()),
                    scanning: AtomicU32::new(0),
                },
                root,
            }
        }

        fn call(&self, method: &str, path: &str, body: &[u8]) -> Response {
            self.with_headers(method, path, body, HashMap::new())
        }

        fn with_headers(
            &self,
            method: &str,
            path: &str,
            body: &[u8],
            headers: HashMap<String, String>,
        ) -> Response {
            let request = Request {
                method: method.to_string(),
                path: path.to_string(),
                headers,
                body: body.to_vec(),
            };
            route(&request, &self.state).unwrap_or_else(|e| panic!("{method} {path}: {e}"))
        }

        /// The same, but keeping the failure — some routes are *meant* to refuse.
        fn try_call(&self, method: &str, path: &str, body: &[u8]) -> Handler {
            route(
                &Request {
                    method: method.to_string(),
                    path: path.to_string(),
                    headers: HashMap::new(),
                    body: body.to_vec(),
                },
                &self.state,
            )
        }

        fn json(&self, method: &str, path: &str) -> serde_json::Value {
            let response = self.call(method, path, b"");
            assert_eq!(response.status, 200, "{method} {path}");
            serde_json::from_slice(&response.body).expect("not json")
        }
    }

    impl Drop for Harness {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn the_root_is_the_mount() {
        let h = Harness::new("root");
        let body = h.json("GET", "/api/root");
        assert_eq!(body["root"].as_str().unwrap(), h.root.to_string_lossy());
    }

    /// The world document is text, and writing it must never overwrite.
    #[test]
    fn the_world_document_round_trips_as_text_and_is_written_once() {
        let h = Harness::new("world");
        assert_eq!(h.call("GET", "/api/world", b"").status, 404);
        // No file yet, so no stamp to report.
        assert!(h.json("GET", "/api/world/stamp")["stamp"].is_null());

        // Comments and all: this is a file a person edits.
        let text = b"{\n  // a room\n  \"rooms\": []\n}";
        let written = h.call("POST", "/api/world", text);
        assert_eq!(written.status, 200);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&written.body).unwrap()["written"],
            serde_json::Value::Bool(true),
        );

        let read = h.call("GET", "/api/world", b"");
        assert_eq!(read.status, 200);
        assert_eq!(read.body, text.to_vec(), "the comments did not survive");
        assert!(read.content_type.starts_with("text/plain"));
        assert!(h.json("GET", "/api/world/stamp")["stamp"].is_string());

        // A second write is refused rather than replacing a room somebody built.
        let again = h.call("POST", "/api/world", b"{}");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&again.body).unwrap()["written"],
            serde_json::Value::Bool(false),
        );
        assert_eq!(h.call("GET", "/api/world", b"").body, text.to_vec());
    }

    #[test]
    fn the_layout_round_trips_and_a_truncated_one_is_refused() {
        let h = Harness::new("layout");
        assert_eq!(h.call("GET", "/api/layout", b"").status, 404);

        let layout = br#"{"rows":{"west-0:0":["abc"]}}"#;
        assert_eq!(h.call("PUT", "/api/layout", layout).status, 204);

        let back: serde_json::Value = serde_json::from_slice(&h.call("GET", "/api/layout", b"").body).unwrap();
        assert_eq!(back["rows"]["west-0:0"][0], "abc");

        // Parsed before written: a half-sent PUT must not leave a layout the
        // next load refuses, which reads as the library forgetting everything.
        assert!(h.try_call("PUT", "/api/layout", br#"{"rows":"#).is_err());
        let still: serde_json::Value = serde_json::from_slice(&h.call("GET", "/api/layout", b"").body).unwrap();
        assert_eq!(still["rows"]["west-0:0"][0], "abc");
    }

    #[test]
    fn the_lamps_and_the_weather_round_trip_too() {
        let h = Harness::new("ambience");
        assert_eq!(h.call("GET", "/api/ambience", b"").status, 404);
        assert_eq!(
            h.call("PUT", "/api/ambience", br#"{"on":{"lamp":false},"rain":true}"#)
                .status,
            204
        );
        let back: serde_json::Value =
            serde_json::from_slice(&h.call("GET", "/api/ambience", b"").body).unwrap();
        assert_eq!(back["on"]["lamp"], serde_json::Value::Bool(false));
        assert_eq!(back["rain"], serde_json::Value::Bool(true));
        assert!(save_files(&h.root).ambience.exists());
    }

    #[test]
    fn the_bookmarks_and_notes_round_trip_and_a_truncated_put_is_refused() {
        let h = Harness::new("annotations");
        assert_eq!(h.call("GET", "/api/annotations", b"").status, 404);

        let doc = br#"{"books":{"abc":{"title":"A Book","author":null,"bookmarks":[1,45]}}}"#;
        assert_eq!(h.call("PUT", "/api/annotations", doc).status, 204);

        let back: serde_json::Value =
            serde_json::from_slice(&h.call("GET", "/api/annotations", b"").body).unwrap();
        assert_eq!(back["books"]["abc"]["bookmarks"][1], 45);
        assert!(save_files(&h.root).annotations.exists());

        // Parsed before it is written, like the layout: a half-sent PUT must not
        // leave a file the next load refuses.
        assert!(h.try_call("PUT", "/api/annotations", br#"{"books":"#).is_err());
        let still: serde_json::Value =
            serde_json::from_slice(&h.call("GET", "/api/annotations", b"").body).unwrap();
        assert_eq!(still["books"]["abc"]["title"], "A Book");

        // The save panel can point at the file: that is half the point of it.
        assert!(h.json("GET", "/api/paths")["annotations"].is_string());
    }

    /// The three folders that are not books, each answering with a list rather
    /// than an error when it is not there.
    #[test]
    fn the_media_folders_are_listed_and_an_absent_one_is_simply_empty() {
        let h = Harness::new("media-lists");
        assert_eq!(h.json("GET", "/api/music").as_array().unwrap().len(), 0);
        assert_eq!(h.json("GET", "/api/artwork").as_array().unwrap().len(), 0);
        assert_eq!(h.json("GET", "/api/video").as_array().unwrap().len(), 0);

        fs::write(h.root.join("music/04 four women.mp3"), b"not really an mp3").unwrap();
        fs::create_dir_all(h.root.join("video/Tarkovsky")).unwrap();
        fs::write(h.root.join("video/Tarkovsky/stalker.mp4"), b"not really an mp4").unwrap();

        let tracks = h.json("GET", "/api/music");
        assert_eq!(tracks.as_array().unwrap().len(), 1);
        assert_eq!(tracks[0]["title"], "04 Four Women");

        let tapes = h.json("GET", "/api/video");
        assert_eq!(tapes.as_array().unwrap().len(), 1);
        assert_eq!(tapes[0]["title"], "Stalker");
        assert_eq!(tapes[0]["series"], "Tarkovsky");
        // camelCase across the wire, because the front end reads it directly.
        assert!(tapes[0]["sizeBytes"].is_number());
    }

    #[test]
    fn a_rom_is_listed_and_fetched_by_id_and_an_unknown_one_is_a_404() {
        let h = Harness::new("roms");
        assert_eq!(h.json("GET", "/api/roms").as_array().unwrap().len(), 0);

        fs::create_dir_all(h.root.join("roms/ch8")).unwrap();
        fs::write(h.root.join("roms/ch8/pong.ch8"), b"\x12\x00").unwrap();

        let roms = h.json("GET", "/api/roms");
        assert_eq!(roms.as_array().unwrap().len(), 1);
        assert_eq!(roms[0]["title"], "Pong");
        assert_eq!(roms[0]["series"], "ch8");
        let id = roms[0]["id"].as_str().unwrap().to_string();

        let bytes = h.call("GET", &format!("/api/rom/{id}"), b"");
        assert_eq!(bytes.status, 200);
        assert_eq!(bytes.body, b"\x12\x00".to_vec());

        assert_eq!(h.call("GET", "/api/rom/nothing-like-that", b"").status, 404);
    }

    /// A scan, end to end, through the route the container actually uses.
    #[test]
    fn a_scan_indexes_the_books_folder_and_nothing_else() {
        let h = Harness::new("scan");
        fs::write(h.root.join("books/on_the_provinces.pdf"), b"%PDF-1.4 not really").unwrap();
        fs::write(h.root.join("music/track.mp3"), b"notes").unwrap();

        assert_eq!(h.json("GET", "/api/books").as_array().unwrap().len(), 0);

        let summary = serde_json::from_slice::<serde_json::Value>(
            &h.call("POST", "/api/scan", b"").body,
        )
        .unwrap();
        assert_eq!(summary["found"], 1, "the mp3 was indexed as a book");

        let books = h.json("GET", "/api/books");
        assert_eq!(books.as_array().unwrap().len(), 1);
        // Unreadable is still indexed, under its filename.
        assert_eq!(books[0]["title"], "On The Provinces");

        // The progress poll reports a finished scan rather than one still running,
        // or the driver polls forever.
        let progress = h.json("GET", "/api/scan/progress");
        assert_eq!(progress["running"], serde_json::Value::Bool(false));
        assert_eq!(progress["total"], 1);
    }

    #[test]
    fn a_book_is_fetched_by_index_id_and_an_unknown_one_is_a_404() {
        let h = Harness::new("book");
        fs::write(h.root.join("books/letters.pdf"), b"%PDF-1.4 pages here").unwrap();
        h.call("POST", "/api/scan", b"");

        let books = h.json("GET", "/api/books");
        let id = books[0]["id"].as_str().unwrap().to_string();

        let bytes = h.call("GET", &format!("/api/book/{id}"), b"");
        assert_eq!(bytes.status, 200);
        assert_eq!(bytes.body, b"%PDF-1.4 pages here".to_vec());

        assert_eq!(h.call("GET", "/api/book/nothing-like-that", b"").status, 404);
    }

    #[test]
    fn a_cover_is_cached_and_a_forged_id_is_refused() {
        let h = Harness::new("cover");
        fs::write(h.root.join("books/one.pdf"), b"%PDF-1.4 x").unwrap();
        h.call("POST", "/api/scan", b"");
        let id = h.json("GET", "/api/books")[0]["id"].as_str().unwrap().to_string();

        let png = b"data:image/png;base64,aGVsbG8=";
        let saved = h.call("POST", &format!("/api/cover/{id}"), png);
        assert_eq!(saved.status, 200);
        let path = serde_json::from_slice::<serde_json::Value>(&saved.body).unwrap()["path"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(fs::read(&path).unwrap(), b"hello".to_vec());

        // The index now knows about it, so the next `list_books` hands it over.
        assert!(h.json("GET", "/api/books")[0]["cover"].as_str().unwrap().ends_with(".png"));

        // The id becomes a filename, and `join` follows `..`.
        assert_eq!(h.call("POST", "/api/cover/..%2Fescape", png).status, 400);
        assert_eq!(h.call("POST", "/api/cover/has spaces", png).status, 400);
        // Windows device names are not usable file names anywhere the folder
        // might sync to.
        assert_eq!(h.call("POST", "/api/cover/NUL", png).status, 400);
        assert_eq!(h.call("POST", "/api/cover/com7", png).status, 400);
        // A well-formed id the index has never heard of writes nothing: covers
        // are cached for books, not for whoever likes filling the disk.
        assert_eq!(h.call("POST", "/api/cover/0123456789abcdef", png).status, 404);
        assert!(!save_files(&h.root).covers.join("0123456789abcdef.png").exists());
        // A body that is not a data URL is refused rather than written as bytes.
        assert!(h.try_call("POST", &format!("/api/cover/{id}"), b"just some text").is_err());
    }

    /// Serving a media file, including the part that makes a tape seekable.
    #[test]
    fn media_is_served_with_ranges_and_only_from_the_allowed_folders() {
        let h = Harness::new("media-serve");
        let track = h.root.join("music/side-a.mp3");
        fs::write(&track, b"0123456789").unwrap();
        fs::write(h.root.join("books/private.pdf"), b"secret").unwrap();

        let whole = h.call("GET", &format!("/media/{}", track.to_string_lossy()), b"");
        assert_eq!(whole.status, 200);
        assert_eq!(whole.content_type, "audio/mpeg");
        // Advertised, or a player will not attempt to seek at all.
        assert!(whole.extra.iter().any(|(k, v)| k == "Accept-Ranges" && v == "bytes"));
        // Streamed, not buffered: the body rides in the file handle.
        assert!(whole.file.is_some());
        assert_eq!(whole.into_body_bytes(), b"0123456789".to_vec());

        let mut headers = HashMap::new();
        headers.insert("range".to_string(), "bytes=2-5".to_string());
        let part = h.with_headers("GET", &format!("/media/{}", track.to_string_lossy()), b"", headers);
        assert_eq!(part.status, 206);
        assert!(part
            .extra
            .iter()
            .any(|(k, v)| k == "Content-Range" && v == "bytes 2-5/10"));
        assert_eq!(part.into_body_bytes(), b"2345".to_vec());

        let mut past = HashMap::new();
        past.insert("range".to_string(), "bytes=99-200".to_string());
        let refused = h.with_headers("GET", &format!("/media/{}", track.to_string_lossy()), b"", past);
        assert_eq!(refused.status, 416);

        // A book is never reachable by name, only through the index.
        let book = h.root.join("books/private.pdf");
        assert_eq!(h.call("GET", &format!("/media/{}", book.to_string_lossy()), b"").status, 404);
        // Nor is anything above the mount, however it is spelled.
        assert_eq!(
            h.call("GET", &format!("/media/{}/music/../../etc/passwd", h.root.to_string_lossy()), b"").status,
            404,
        );
    }

    #[test]
    fn the_front_end_falls_back_to_index_html_and_refuses_to_climb_out_of_dist() {
        let h = Harness::new("static");
        // No dist at all: a plain answer that says what to do, not a 500.
        let missing = h.call("GET", "/", b"");
        assert_eq!(missing.status, 404);
        assert!(String::from_utf8_lossy(&missing.body).contains("build:http"));

        let dist = h.root.join("no-dist");
        fs::create_dir_all(dist.join("assets")).unwrap();
        fs::write(dist.join("index.html"), b"<!doctype html>room").unwrap();
        fs::write(dist.join("assets/app.js"), b"console.log(1)").unwrap();

        let index = h.call("GET", "/", b"");
        assert_eq!(index.status, 200);
        assert!(index.content_type.starts_with("text/html"));

        let js = h.call("GET", "/assets/app.js", b"");
        assert_eq!(js.status, 200);
        assert!(js.content_type.starts_with("text/javascript"));

        // A single-page app: an unknown path is a route, not a missing file.
        assert_eq!(h.call("GET", "/some/deep/route", b"").body, b"<!doctype html>room".to_vec());

        // ...but `..` is never a route.
        assert_eq!(h.call("GET", "/../../secret", b"").status, 404);
    }

    #[test]
    fn a_method_nothing_answers_is_a_405() {
        let h = Harness::new("method");
        assert_eq!(h.call("DELETE", "/api/layout", b"").status, 405);
        assert_eq!(h.call("PUT", "/api/books", b"").status, 405);
    }

    #[test]
    fn base64_round_trips_what_a_canvas_produces() {
        // "hello" — the padding case, which is the one that goes wrong.
        assert_eq!(decode_base64("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(decode_base64("aGVsbG8h").unwrap(), b"hello!");
        assert_eq!(decode_base64("").unwrap(), Vec::<u8>::new());
        assert!(decode_base64("not base64!").is_none());
    }

    /// The one security property: a browser may read the media folders and
    /// nothing else — not the index, not the books, not above the mount.
    #[test]
    fn only_the_media_folders_are_readable() {
        let root = temp_root("scope");
        fs::write(root.join("music/track.mp3"), b"notes").unwrap();
        fs::write(root.join("books/private.pdf"), b"pages").unwrap();
        fs::write(save_files(&root).layout, b"{}").unwrap();
        fs::write(root.join("secret.txt"), b"shh").unwrap();

        assert!(is_allowed(&root.join("music/track.mp3"), &root));
        // A book is served by id, through the index, and never by name.
        assert!(!is_allowed(&root.join("books/private.pdf"), &root));
        // A ROM likewise: `/api/rom/<id>`, never `/media/roms/...`.
        {
            fs::create_dir_all(root.join("roms")).unwrap();
            fs::write(root.join("roms/game.ch8"), b"rom").unwrap();
            assert!(!is_allowed(&root.join("roms/game.ch8"), &root));
        }
        assert!(!is_allowed(&root.join("secret.txt"), &root));
        assert!(!is_allowed(&save_files(&root).layout, &root));
        // Traversal out of an allowed folder resolves away before the check.
        assert!(!is_allowed(&root.join("music/../secret.txt"), &root));
        // A directory is not a file.
        assert!(!is_allowed(&root.join("music"), &root));
        // Something that is not there at all is refused rather than opened.
        assert!(!is_allowed(&root.join("music/absent.mp3"), &root));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_missing_covers_folder_does_not_make_the_others_unreadable() {
        // A library with no artwork folder has a root that cannot be
        // canonicalised; that must not take the rest of the list with it.
        let root = temp_root("partial");
        fs::write(root.join("music/track.mp3"), b"notes").unwrap();
        assert!(!root.join("artwork").exists());
        assert!(is_allowed(&root.join("music/track.mp3"), &root));
        let _ = fs::remove_dir_all(&root);
    }
}

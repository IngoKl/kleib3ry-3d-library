//! kleib3ry over HTTP: the third driver's other half.
//!
//! The front end has always reached the filesystem through one interface, with
//! the promise that "a Linux-hosted web build is a driver swap rather than a
//! rewrite". This is what that swap talks to. Every route here answers exactly
//! one method of `LibraryService`, in the same order they are declared in
//! `src/services/types.ts`, so the two files can be read side by side.
//!
//! Two things it does that the desktop shell does not have to:
//!
//!   - It serves the built front end itself, so the container is one process.
//!   - It serves media by *path*, under `/media/`, with every path checked
//!     against the library folder before a byte is read. The desktop app grants
//!     the WebView three directories through Tauri's asset scope; there is no
//!     such scope here, so the check is this file's job and it is the one piece
//!     of security in the whole program.
//!
//! Run it with the library folder as its only required argument:
//!
//!     kleib3ry-server --root /library --dist /app/dist --port 8080

mod http;

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use kleib3ry_core::{db, index, media, save_files, stamp_of};
use serde_json::json;

use http::{Request, Response};

struct Config {
    root: PathBuf,
    dist: PathBuf,
}

/// What a scan is doing, for the progress poll.
///
/// The desktop app pushes progress into the WebView as Tauri events. There is no
/// event channel here, and inventing one — server-sent events, a websocket —
/// would be a second protocol for one number. The driver polls this instead,
/// which is a stat-sized request every quarter second for the duration of a scan
/// and nothing at all the rest of the time.
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
    /// Non-zero while a scan is running, so a second one is refused rather than
    /// racing the first over the same SQLite file.
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

    // The environment is how a container is configured, and the flags win, so
    // both a compose file and a shell are comfortable.
    let root = root
        .or_else(|| std::env::var_os("KLEIB3RY_LIBRARY").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("/library"));

    if !root.is_dir() {
        eprintln!("not a directory: {}", root.display());
        eprintln!("mount your library folder there, or pass --root");
        return std::process::ExitCode::FAILURE;
    }
    // Canonicalised once, at startup, because every path check below compares
    // against it — and a symlinked mount point would otherwise make each of
    // those comparisons fail for a file that is genuinely inside the library.
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
    println!("  index    {}", files.database.display());
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
        let state = Arc::clone(&state);
        // A thread per connection. This serves one household; a thread pool
        // would be machinery for a load that does not exist, and a book being
        // read must not block a track being streamed.
        std::thread::spawn(move || serve(stream, &state));
    }

    std::process::ExitCode::SUCCESS
}

fn serve(stream: TcpStream, state: &State) {
    let Some(request) = http::read_request(&stream) else {
        http::write_response(&stream, Response::text(400, "bad request"));
        return
    };
    let response = route(&request, state).unwrap_or_else(|message| Response::text(500, &message));
    http::write_response(&stream, response);
}

/// Errors are strings on purpose.
///
/// They go straight into the HUD's error line, which is where the desktop app's
/// go too — and the front end has no way to act differently on a missing file
/// than on a corrupt one, so a taxonomy would be a taxonomy nobody reads.
type Handler = std::result::Result<Response, String>;

fn oops<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn route(request: &Request, state: &State) -> Handler {
    let path = request.path.as_str();
    let method = request.method.as_str();
    let files = save_files(&state.config.root);

    match (method, path) {
        // ---- where the library is -------------------------------------------
        //
        // The root is the mount, not a choice: there is no folder picker in a
        // container, and offering one would mean letting the browser walk the
        // server's disk. `canPickFolder` is false in this driver for that reason.
        ("GET", "/api/root") => Ok(Response::json(&json!({
            "root": state.config.root.to_string_lossy(),
        }))),

        // ---- books -----------------------------------------------------------
        ("GET", "/api/books") => {
            let conn = db::open(&files.database).map_err(oops)?;
            let books = db::list_books(&conn).map_err(oops)?;
            // Covers come back as absolute paths, exactly as the desktop app's
            // do, and the driver turns them into `/media/...` URLs.
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

        ("POST", "/api/scan") => {
            // One at a time. Two scans over one SQLite file is a race with a
            // corrupt index at the end of it.
            if state.scanning.swap(1, Ordering::SeqCst) == 1 {
                return Ok(Response::text(409, "a scan is already running"));
            }
            {
                let mut progress = state.progress.lock().unwrap();
                *progress = Progress { running: true, ..Default::default() };
            }

            let outcome = index::scan(
                &state.config.root,
                &files.database,
                &files.covers,
                |update| {
                    let mut progress = state.progress.lock().unwrap();
                    progress.done = update.done;
                    progress.total = update.total;
                    progress.current = update.current;
                    progress.running = true;
                },
            );

            state.progress.lock().unwrap().running = false;
            state.scanning.store(0, Ordering::SeqCst);

            let summary = outcome.map_err(oops)?;
            Ok(Response::json(&serde_json::to_value(summary).map_err(oops)?))
        }

        ("GET", "/api/scan/progress") => {
            let progress = state.progress.lock().unwrap().clone();
            Ok(Response::json(&serde_json::to_value(progress).map_err(oops)?))
        }

        // ---- the world document, as text ------------------------------------
        ("GET", "/api/world") => match fs::read_to_string(&files.world) {
            Ok(text) => Ok(Response::new(200, "text/plain; charset=utf-8", text.into_bytes())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Response::empty(404)),
            Err(e) => Err(oops(e)),
        },

        // Writes the starter document and only that: refuses to overwrite, for
        // the same reason the desktop command does — this is called on first run
        // and a race here would replace a room somebody built.
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

        ("GET", "/api/lights") => match fs::read_to_string(&files.lights) {
            Ok(text) => Ok(Response::new(200, "application/json; charset=utf-8", text.into_bytes())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Response::empty(404)),
            Err(e) => Err(oops(e)),
        },

        ("PUT", "/api/lights") => {
            write_json_file(&files.lights, &request.body)?;
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

        _ => route_by_prefix(request, state),
    }
}

fn route_by_prefix(request: &Request, state: &State) -> Handler {
    let path = request.path.as_str();
    let method = request.method.as_str();
    let files = save_files(&state.config.root);

    // A book's bytes, for pdf.js. Read whole and answered whole, exactly as the
    // desktop `read_book_file` command does: the reader parses the file in one
    // go, so there is nothing for a range to save.
    if method == "GET" {
        if let Some(id) = path.strip_prefix("/api/book/") {
            let conn = db::open(&files.database).map_err(oops)?;
            let Some(book) = db::path_of(&conn, id).map_err(oops)? else {
                return Ok(Response::text(404, "no such book"))
            };
            let bytes = fs::read(&book).map_err(oops)?;
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
    // Parsed before it is written, so a truncated PUT cannot leave a layout file
    // that the next load refuses — which would look like the library forgetting
    // where every book was.
    let value: serde_json::Value = serde_json::from_slice(body).map_err(oops)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(oops)?;
    }
    fs::write(path, serde_json::to_string_pretty(&value).map_err(oops)?).map_err(oops)
}

fn save_cover(id: &str, body: &[u8], files: &kleib3ry_core::SaveFiles) -> Handler {
    // The id becomes a file name in the covers directory. It is normally a hex
    // hash, but it arrives from a browser, and `join` follows `..` and absolute
    // paths — so anything that is not a plain name is a write outside the cache.
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Ok(Response::text(400, "not a cover id"));
    }
    let text = std::str::from_utf8(body).map_err(oops)?;
    let payload = text
        .split_once(";base64,")
        .map(|(_, rest)| rest)
        .ok_or("expected a base64 data URL")?;
    let bytes = decode_base64(payload).ok_or("not valid base64")?;

    let name = format!("{id}.png");
    fs::create_dir_all(&files.covers).map_err(oops)?;
    fs::write(files.covers.join(&name), &bytes).map_err(oops)?;

    let conn = db::open(&files.database).map_err(oops)?;
    db::set_cover(&conn, id, &name).map_err(oops)?;
    Ok(Response::json(&json!({
        "path": files.covers.join(&name).to_string_lossy(),
    })))
}

/// Standard base64, no line breaks, `=` padding. Twenty lines rather than a
/// dependency, and the only thing that ever posts to it is our own front end.
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

/// The three directories a library folder lets the front end read.
///
/// The same three the desktop app grants through Tauri's asset scope — covers,
/// music, artwork — plus video, which the television needs. Nothing else in the
/// library folder is reachable, and in particular `books/` is not: a book goes
/// through `/api/book/<id>`, which means the only files a browser can name
/// directly are the ones the index already told it about.
fn media_roots(root: &Path) -> Vec<PathBuf> {
    let files = save_files(root);
    vec![
        files.covers,
        root.join(media::MUSIC_DIR),
        root.join(media::ARTWORK_DIR),
        root.join(media::VIDEO_DIR),
    ]
}

/// True if `path` really is inside one of the directories we are prepared to
/// serve.
///
/// Canonicalised first, which is the whole point: `..` in a URL, a symlink
/// planted in `music/`, and a Windows short name all resolve away before the
/// comparison, and a path that cannot be canonicalised does not exist and is
/// therefore not allowed either.
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
    // index hands it and inventing a second naming scheme for the same files
    // would mean the two could disagree.
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

    let length = fs::metadata(&wanted).map_err(oops)?.len();
    let mime = http::mime_of(&wanted);

    // A range, if one was asked for. This is what makes a tape seekable.
    if let Some(header) = request.header("range") {
        return match http::parse_range(header, length) {
            Some((start, end)) => {
                let mut file = fs::File::open(&wanted).map_err(oops)?;
                file.seek(SeekFrom::Start(start)).map_err(oops)?;
                let mut bytes = vec![0u8; (end - start + 1) as usize];
                file.read_exact(&mut bytes).map_err(oops)?;
                Ok(Response::new(206, mime, bytes)
                    .with("Content-Range", &format!("bytes {start}-{end}/{length}"))
                    .with("Accept-Ranges", "bytes"))
            }
            None => Ok(Response::empty(416).with("Content-Range", &format!("bytes */{length}"))),
        };
    }

    let bytes = fs::read(&wanted).map_err(oops)?;
    Ok(Response::new(200, mime, bytes).with("Accept-Ranges", "bytes"))
}

/// The built front end.
///
/// A single-page app, so anything that is not a file falls back to `index.html`
/// — and the path is resolved component by component with `..` refused outright,
/// rather than canonicalised, because `dist/` may legitimately not exist yet and
/// a missing directory should read as "no front end" rather than as an error.
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

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kleib3ry-server-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("music")).unwrap();
        fs::create_dir_all(dir.join("books")).unwrap();
        fs::create_dir_all(save_files(&dir).covers).unwrap();
        dir
    }

    #[test]
    fn base64_round_trips_what_a_canvas_produces() {
        // "hello" — the padding case, which is the one that goes wrong.
        assert_eq!(decode_base64("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(decode_base64("aGVsbG8h").unwrap(), b"hello!");
        assert_eq!(decode_base64("").unwrap(), Vec::<u8>::new());
        assert!(decode_base64("not base64!").is_none());
    }

    /// The one security property in the program: a browser may read the three
    /// media folders and nothing else — not the index, not the books, and
    /// certainly not whatever is above the mount.
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
        // `is_allowed` canonicalises each allowed root, and a library with no
        // artwork folder has one that cannot be canonicalised. That must not
        // take the rest of the list with it.
        let root = temp_root("partial");
        fs::write(root.join("music/track.mp3"), b"notes").unwrap();
        assert!(!root.join("artwork").exists());
        assert!(is_allowed(&root.join("music/track.mp3"), &root));
        let _ = fs::remove_dir_all(&root);
    }
}

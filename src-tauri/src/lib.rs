//! The desktop shell: commands, settings, and the paths they resolve.
//!
//! Everything that actually reads a book lives in `kleib3ry_core`, which has no
//! idea a window exists. What is left here is the part that is genuinely about
//! being a desktop app — the IPC surface, the asset-protocol scope, the native
//! folder picker, and where an installed application is allowed to keep files.
//!
//! The modules are re-exported because `src/bin/scan.rs` and the tests reach
//! for them by their old names, and because "the core is over there" is worth
//! being able to see from here.

pub use kleib3ry_core::{catalog, index, media, probe};

use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use catalog::{Book, Catalog};

/// What can go wrong in the shell: whatever the core can, plus Tauri itself.
///
/// The core's errors are flattened rather than nested — `Core(#[from] ...)` with
/// a transparent message — so a failure reads the same in the HUD whether it
/// came from the indexer or from the window manager. A user does not care which
/// crate could not find their book.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Core(#[from] kleib3ry_core::Error),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Tauri(#[from] tauri::Error),
    #[error("not a directory: {0}")]
    NotADirectory(String),
    #[error("bad image data: {0}")]
    BadImage(String),
    #[error("a scan is already running")]
    ScanInProgress,
}

/// The one core error the shell asks about by name, because it is not a failure
/// so much as a state: there is no library folder yet, and the answer to most
/// questions is therefore "nothing" rather than an error.
fn is_no_root(error: &Error) -> bool {
    matches!(error, Error::Core(kleib3ry_core::Error::NoLibraryRoot))
}

// Commands must return something serde can hand to the WebView.
// Spelled out in full because the `Result` alias below is single-parameter.
impl Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

type Result<T> = std::result::Result<T, Error>;

/// On-disk user settings, kept as readable camelCase JSON next to the layout.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub library_root: Option<String>,
}

impl Settings {
    fn load_from(path: &Path) -> Result<Self> {
        match fs::read_to_string(path) {
            Ok(text) => Ok(serde_json::from_str(&text)?),
            // A missing settings file is the normal first-run state.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.into()),
        }
    }

    fn save_to(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }
}

/// Where everything the app owns lives when there is no library folder yet.
///
/// Note what is *not* here: the world document, the book layout, the index and
/// the covers. Those are the save file, and a save file belongs to the library
/// it describes, so they live in the library folder itself — see
/// `kleib3ry_core::save_files`, which both this and the server read.
struct Paths {
    settings: PathBuf,
    covers: PathBuf,
    /// Used for the save files only until a library folder has been chosen.
    fallback: PathBuf,
}

impl Paths {
    fn resolve(app: &AppHandle) -> Result<Self> {
        let config = app.path().app_config_dir()?;
        let data = app.path().app_data_dir()?;
        fs::create_dir_all(&config)?;
        fs::create_dir_all(&data)?;
        Ok(Self {
            settings: config.join("settings.json"),
            covers: data.join("covers"),
            fallback: config.clone(),
        })
    }
}

fn paths(app: &AppHandle) -> Result<Paths> {
    Paths::resolve(app)
}

fn root_of(app: &AppHandle) -> Result<PathBuf> {
    let settings = Settings::load_from(&paths(app)?.settings)?;
    settings
        .library_root
        .map(PathBuf::from)
        .ok_or(Error::Core(kleib3ry_core::Error::NoLibraryRoot))
}

pub use kleib3ry_core::CONFIG_DIR;

/// The two files that make a folder a library.
///
/// `library.json` is the room, hand-edited. `books.json` is which book sits on
/// which shelf, machine-written and far too long to read. Both sit in the
/// library folder, so copying that folder copies the library — and pointing the
/// app at a different folder opens a different library, furniture and all.
///
/// Before a folder has been chosen there is nowhere to put them, so they fall
/// back to the app's own config directory and move the first time you choose one.
struct SaveFiles {
    world: PathBuf,
    layout: PathBuf,
    /// Which lamps are on and what the weather is doing. Its own file because
    /// it is about the room rather than about the books, and because deleting
    /// it is a sensible way to get every light and the daylight back.
    ambience: PathBuf,
    /// Bookmarks and notes. Its own readable file so the marginalia are the
    /// user's without the app.
    annotations: PathBuf,
}

/// Where rendered and extracted covers are cached.
///
/// In the library folder, under `.library/`, so that the folder carries its own
/// artwork: rasterising a thousand PDF first pages takes minutes, and copying a
/// library to another machine should not mean doing it again. Falls back to the
/// app's data directory until a folder has been chosen.
fn covers_dir(app: &AppHandle) -> Result<PathBuf> {
    match root_of(app) {
        Ok(root) => Ok(kleib3ry_core::save_files(&root).covers),
        Err(e) if is_no_root(&e) => Ok(paths(app)?.covers),
        Err(e) => Err(e),
    }
}

/// The book index, beside the covers it refers to.
///
/// In the library folder so that `npm run scan` and the app are looking at the
/// same index — a command that scans a folder the app then ignores would be a
/// trap. It is still a derived file: delete it and rescan.
///
/// No fallback for "no folder chosen yet": an index describes a library, and
/// without one there is nothing to describe. Callers answer with an empty
/// catalogue instead.
fn index_file(app: &AppHandle) -> Result<PathBuf> {
    Ok(kleib3ry_core::save_files(&root_of(app)?).index)
}

/// Let the WebView load images out of the cover cache.
///
/// The asset protocol starts with an empty scope, so without this every cover
/// is a silently broken image — and the cache now lives at a path the user
/// chose, which cannot be known at build time.
fn allow_covers(app: &AppHandle) -> Result<PathBuf> {
    let dir = covers_dir(app)?;
    fs::create_dir_all(&dir)?;
    app.asset_protocol_scope().allow_directory(&dir, false)?;
    Ok(dir)
}

fn save_files(app: &AppHandle) -> Result<SaveFiles> {
    match root_of(app) {
        Ok(root) => {
            let files = kleib3ry_core::save_files(&root);
            Ok(SaveFiles {
                world: files.world,
                layout: files.layout,
                ambience: files.ambience,
                annotations: files.annotations,
            })
        }
        Err(e) if is_no_root(&e) => {
            let base = paths(app)?.fallback;
            Ok(SaveFiles {
                world: base.join("library.json"),
                layout: base.join("books.json"),
                ambience: base.join("ambience.json"),
                annotations: base.join("annotations.json"),
            })
        }
        Err(e) => Err(e),
    }
}

/// Let the WebView load one of the library folder's own media directories.
///
/// The asset scope starts empty and stays that way apart from three named
/// directories — covers, music, artwork — each granted only when something
/// actually asks for it. Audio is the reason this exists rather than a
/// `read_music_file` command to match `read_book_file`: a track is streamed
/// while it plays, and pulling a whole FLAC through IPC to play it would be
/// both slower and a great deal more memory than letting the WebView fetch it.
fn allow_media(app: &AppHandle, name: &str) -> Result<Option<PathBuf>> {
    let root = match root_of(app) {
        Ok(root) => root,
        Err(e) if is_no_root(&e) => return Ok(None),
        Err(e) => return Err(e),
    };
    let dir = root.join(name);
    if !dir.is_dir() {
        return Ok(None);
    }
    app.asset_protocol_scope().allow_directory(&dir, true)?;
    Ok(Some(dir))
}

use kleib3ry_core::{stamp_of, write_atomic};

/// One scan at a time: two scans of one folder only race each other's work,
/// each overwriting the other's index, which is why the server refuses it too.
#[derive(Default)]
struct ScanGuard(std::sync::atomic::AtomicBool);

// ---- commands ----------------------------------------------------------

#[tauri::command]
fn get_library_root(app: AppHandle) -> Result<Option<String>> {
    Ok(Settings::load_from(&paths(&app)?.settings)?.library_root)
}

/// A library root is stored canonical: an existing directory, made absolute,
/// so a relative path cannot quietly mean "relative to wherever the app
/// happened to start".
fn normalize_root(raw: &str) -> Result<String> {
    let dir = PathBuf::from(raw);
    if !dir.is_dir() {
        return Err(Error::NotADirectory(raw.to_string()));
    }
    let real = dir
        .canonicalize()
        .map_err(|_| Error::NotADirectory(raw.to_string()))?;
    // On Windows `canonicalize` yields a `\\?\C:\...` verbatim path, which the
    // asset scope and the front end both display and match poorly. Strip it
    // for plain drive paths; UNC paths keep theirs.
    let text = real.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => Ok(rest.to_string()),
        _ => Ok(text.into_owned()),
    }
}

/// `None` clears the choice, which is also how a test harness puts the user's
/// settings back the way it found them.
#[tauri::command]
fn set_library_root(app: AppHandle, path: Option<String>) -> Result<()> {
    let path = match path {
        Some(raw) => Some(normalize_root(&raw)?),
        None => None,
    };
    let file = paths(&app)?.settings;
    let mut settings = Settings::load_from(&file)?;
    settings.library_root = path;
    settings.save_to(&file)
}

/// Absolute cover paths, so the front end can hand them straight to the asset
/// protocol without knowing where the app keeps its cache.
fn absolutise(mut books: Vec<Book>, covers: &Path) -> Vec<Book> {
    for book in &mut books {
        if let Some(name) = &book.cover {
            book.cover = Some(covers.join(name).to_string_lossy().to_string());
        }
    }
    books
}

#[tauri::command]
fn list_books(app: AppHandle) -> Result<Vec<Book>> {
    let root = match root_of(&app) {
        Ok(root) => root,
        // Nothing chosen yet is an empty library, not a failure.
        Err(e) if is_no_root(&e) => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let covers = allow_covers(&app)?;
    let catalog = Catalog::load(&index_file(&app)?)?;
    Ok(absolutise(catalog.list_books(&root, &covers), &covers))
}

/// Walk the library folder and reconcile the index with it.
///
/// `async` is load-bearing: a plain `#[tauri::command]` runs on the main thread,
/// so indexing a real collection froze the window until Windows declared it hung.
/// Marked async, it goes to the runtime's worker instead and the UI keeps
/// painting the progress it is being sent.
#[tauri::command(async)]
fn scan_library(app: AppHandle, guard: tauri::State<'_, ScanGuard>) -> Result<index::ScanSummary> {
    use std::sync::atomic::Ordering;
    if guard.0.swap(true, Ordering::SeqCst) {
        return Err(Error::ScanInProgress);
    }
    // A drop guard, so an error — or a panic escaping the scan — cannot leave
    // the flag set and every later scan refused.
    struct Release<'a>(&'a ScanGuard);
    impl Drop for Release<'_> {
        fn drop(&mut self) {
            self.0 .0.store(false, Ordering::SeqCst);
        }
    }
    let _release = Release(&guard);

    let root = root_of(&app)?;
    let index_path = index_file(&app)?;
    let covers = allow_covers(&app)?;
    let emitter = app.clone();

    // One event per file is thousands of IPC messages for a real library, which
    // is its own way of wedging the WebView. Report about a hundred times over
    // the whole scan, plus the last one so the bar always finishes.
    let mut last = 0u32;
    // The core reports its own error type; the shell's wraps it.
    Ok(index::scan(&root, &index_path, &covers, move |progress| {
        let step = (progress.total / 100).max(1);
        let final_item = progress.done >= progress.total;
        // The very first event always goes through so the bar appears at the
        // start of the scan rather than one step into it.
        if progress.done != 0 && !final_item && progress.done < last + step {
            return;
        }
        last = progress.done;
        // A dropped progress event is not worth failing the scan over.
        let _ = emitter.emit("scan:progress", progress);
    })?)
}

/// Store a cover the WebView rendered.
///
/// PDF first pages need a real renderer. Rather than ship pdfium and its
/// several megabytes of native library, the front end rasterises page one with
/// pdf.js — which it already loads for reading — and posts the result here to
/// be cached like any other cover.
///
/// The file *is* the record: listing derives a book's cover from what is in the
/// cache, so nothing has to write the index and the scan stays its only writer.
#[tauri::command]
fn save_rendered_cover(app: AppHandle, id: String, data_url: String) -> Result<String> {
    // The id becomes a file name inside the covers directory. It is normally a
    // hex hash, but it arrives from the WebView, and `PathBuf::join` follows
    // `..` and absolute paths — so anything that is not a plain name is a
    // write outside the cache and gets refused.
    if id.is_empty()
        || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(Error::BadImage(format!("not a cover id: {id}")));
    }
    let payload = data_url
        .split_once(";base64,")
        .map(|(_, rest)| rest)
        .ok_or_else(|| Error::BadImage("expected a base64 data URL".into()))?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| Error::BadImage(e.to_string()))?;

    let covers = allow_covers(&app)?;
    let name = format!("{id}.png");
    fs::create_dir_all(&covers)?;
    fs::write(covers.join(&name), &bytes)?;

    Ok(covers.join(&name).to_string_lossy().to_string())
}

/// Raw bytes of a book file, for pdf.js.
///
/// Deliberately not the asset protocol: the library lives at an arbitrary path
/// the user picked, and widening the asset scope to cover it would grant the
/// WebView far more of the disk than reading one indexed book requires.
#[tauri::command]
fn read_book_file(app: AppHandle, id: String) -> Result<tauri::ipc::Response> {
    let root = root_of(&app)?;
    let path = Catalog::load(&index_file(&app)?)?
        .path_of(&root, &id)
        .ok_or_else(|| Error::Core(kleib3ry_core::Error::UnknownBook(id)))?;
    Ok(tauri::ipc::Response::new(fs::read(path)?))
}

/// The world document, returned as *text*.
///
/// Deliberately not parsed here: it is a file a person edits, comments and all,
/// and the front end owns its schema. Rust hands over the bytes and stays out of
/// the way — which also means a document this build cannot understand still
/// round-trips instead of being rewritten into something lossier.
#[tauri::command]
fn get_world(app: AppHandle) -> Result<Option<String>> {
    match fs::read_to_string(&save_files(&app)?.world) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Write the starter document, and only that.
///
/// Refuses to overwrite an existing file: this is called on first run, and a
/// race or a bug here would replace a room somebody built with the default one.
#[tauri::command]
fn write_default_world(app: AppHandle, text: String) -> Result<bool> {
    let file = save_files(&app)?.world;
    if file.exists() {
        return Ok(false);
    }
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&file, text)?;
    Ok(true)
}

#[tauri::command]
fn world_stamp(app: AppHandle) -> Result<Option<String>> {
    Ok(stamp_of(&save_files(&app)?.world))
}

/// Which files the current library is saved into, for the panel to show.
#[tauri::command]
fn save_paths(app: AppHandle) -> Result<serde_json::Value> {
    let files = save_files(&app)?;
    Ok(serde_json::json!({
        "world": files.world.to_string_lossy(),
        "layout": files.layout.to_string_lossy(),
        "annotations": files.annotations.to_string_lossy(),
    }))
}

/// The book layout is an opaque, versioned document owned by the front end.
/// Rust stores and returns it verbatim so the schema can evolve without a
/// matching change on this side.
#[tauri::command]
fn get_layout(app: AppHandle) -> Result<Option<serde_json::Value>> {
    let file = save_files(&app)?.layout;
    match fs::read_to_string(&file) {
        Ok(text) => Ok(Some(serde_json::from_str(&text)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
fn save_layout(app: AppHandle, layout: serde_json::Value) -> Result<()> {
    // Atomic, so a crash mid-write cannot truncate the file that remembers
    // where every book is.
    write_atomic(&save_files(&app)?.layout, serde_json::to_string_pretty(&layout)?.as_bytes())?;
    Ok(())
}

/// Every record in `<library>/music`, with the folder opened to the WebView so
/// the player can stream them.
///
/// Returns an empty list rather than an error when there is no music folder, or
/// no library folder at all: a library nobody has put music in is a normal
/// library, and the record shelf simply stands empty.
#[tauri::command(async)]
fn list_music(app: AppHandle) -> Result<Vec<media::Track>> {
    let Some(dir) = allow_media(&app, media::MUSIC_DIR)? else {
        return Ok(Vec::new());
    };
    // `list_tracks` takes the library root and looks for `music/` itself, so
    // hand it the parent of the directory just authorised.
    Ok(media::list_tracks(dir.parent().unwrap_or(&dir)))
}

/// Every picture in `<library>/artwork`, for hanging on the walls.
#[tauri::command(async)]
fn list_artwork(app: AppHandle) -> Result<Vec<media::Artwork>> {
    let Some(dir) = allow_media(&app, media::ARTWORK_DIR)? else {
        return Ok(Vec::new());
    };
    Ok(media::list_artwork(dir.parent().unwrap_or(&dir)))
}

/// Every tape in `<library>/video`, for the crate beside the television.
///
/// Authorised as a directory rather than served through a command, for exactly
/// the reason audio is: a tape is streamed while it plays, and pulling a
/// gigabyte of MP4 through IPC to watch it would be absurd.
#[tauri::command(async)]
fn list_videos(app: AppHandle) -> Result<Vec<media::Tape>> {
    let Some(dir) = allow_media(&app, media::VIDEO_DIR)? else {
        return Ok(Vec::new());
    };
    Ok(media::list_videos(dir.parent().unwrap_or(&dir)))
}

/// Every ROM in `<library>/roms`, for the arcade machine.
///
/// A listing only — no asset-scope grant, unlike the three folders above,
/// because nothing streams a ROM from a URL: the bytes go through
/// `read_rom_file` the way a book's do.
#[tauri::command(async)]
fn list_roms(app: AppHandle) -> Result<Vec<media::Rom>> {
    match root_of(&app) {
        Ok(root) => Ok(media::list_roms(&root)),
        Err(e) if is_no_root(&e) => Ok(Vec::new()),
        Err(e) => Err(e),
    }
}

/// Raw bytes of one ROM, for the emulator.
///
/// A command rather than a directory in the asset scope, for the reason
/// `read_book_file` is one and `music/` is not: a ROM is a few kilobytes read
/// once at power-on, not a stream played while it runs. The id must be one
/// `list_roms` handed out, so the WebView can only ever name a file the
/// listing already told it about.
#[tauri::command]
fn read_rom_file(app: AppHandle, id: String) -> Result<tauri::ipc::Response> {
    let root = root_of(&app)?;
    let path = media::rom_path(&root, &id)
        .ok_or_else(|| Error::Core(kleib3ry_core::Error::UnknownBook(id)))?;
    Ok(tauri::ipc::Response::new(fs::read(path)?))
}

/// Which lamps are on and what the weather is doing. A missing file means "as
/// `library.json` says", which is also what you get by deleting it.
#[tauri::command]
fn get_ambience(app: AppHandle) -> Result<Option<serde_json::Value>> {
    match fs::read_to_string(&save_files(&app)?.ambience) {
        Ok(text) => Ok(Some(serde_json::from_str(&text)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
fn save_ambience(app: AppHandle, state: serde_json::Value) -> Result<()> {
    write_atomic(&save_files(&app)?.ambience, serde_json::to_string_pretty(&state)?.as_bytes())?;
    Ok(())
}

/// Bookmarks and notes. Opaque to Rust like the layout: the front end owns the
/// schema, this side only keeps the file readable and pretty-printed.
#[tauri::command]
fn get_annotations(app: AppHandle) -> Result<Option<serde_json::Value>> {
    match fs::read_to_string(&save_files(&app)?.annotations) {
        Ok(text) => Ok(Some(serde_json::from_str(&text)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
fn save_annotations(app: AppHandle, doc: serde_json::Value) -> Result<()> {
    write_atomic(&save_files(&app)?.annotations, serde_json::to_string_pretty(&doc)?.as_bytes())?;
    Ok(())
}

/// Write the Markdown digest beside the JSON and say where it landed. The text
/// is composed by the front end; this is only the landing.
#[tauri::command]
fn export_annotations(app: AppHandle, markdown: String) -> Result<String> {
    let file = save_files(&app)?.annotations.with_extension("md");
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&file, markdown)?;
    Ok(file.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ScanGuard::default())
        .invoke_handler(tauri::generate_handler![
            get_library_root,
            set_library_root,
            list_books,
            scan_library,
            save_rendered_cover,
            read_book_file,
            get_world,
            write_default_world,
            world_stamp,
            save_paths,
            get_layout,
            save_layout,
            list_music,
            list_artwork,
            list_videos,
            list_roms,
            read_rom_file,
            get_ambience,
            save_ambience,
            get_annotations,
            save_annotations,
            export_annotations,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_settings_file_reads_as_default() {
        let path = std::env::temp_dir().join("kleib3ry-does-not-exist-9f3c.json");
        let _ = fs::remove_file(&path);
        assert_eq!(Settings::load_from(&path).unwrap(), Settings::default());
    }

    #[test]
    fn settings_round_trip_through_disk() {
        let dir = std::env::temp_dir().join("kleib3ry-test-settings");
        let path = dir.join("settings.json");
        let _ = fs::remove_dir_all(&dir);

        let written = Settings {
            library_root: Some(r"C:\Users\someone\Books".to_string()),
        };
        written.save_to(&path).unwrap();
        assert_eq!(Settings::load_from(&path).unwrap(), written);

        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("libraryRoot"), "expected camelCase key, got: {text}");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_library_root_must_exist_and_is_stored_canonical() {
        let dir = std::env::temp_dir().join("kleib3ry-root-check");
        fs::create_dir_all(&dir).unwrap();

        let stored = normalize_root(&dir.to_string_lossy()).unwrap();
        assert!(Path::new(&stored).is_absolute());
        assert!(!stored.starts_with(r"\\?\"), "verbatim prefix leaked: {stored}");
        assert!(Path::new(&stored).is_dir());

        assert!(normalize_root("kleib3ry-definitely-not-a-real-directory").is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn covers_are_returned_as_absolute_paths() {
        let books = vec![
            Book {
                id: "a".into(),
                path: "x.epub".into(),
                format: catalog::Format::Epub,
                title: "One".into(),
                author: None,
                cover: Some("a.jpg".into()),
                page_count: None,
                size_bytes: 1,
            },
            Book {
                id: "b".into(),
                path: "y.pdf".into(),
                format: catalog::Format::Pdf,
                title: "Two".into(),
                author: None,
                cover: None,
                page_count: None,
                size_bytes: 1,
            },
        ];

        let out = absolutise(books, Path::new("/cache/covers"));
        assert!(out[0].cover.as_ref().unwrap().ends_with("a.jpg"));
        assert!(out[0].cover.as_ref().unwrap().contains("covers"));
        assert_eq!(out[1].cover, None);
    }
}

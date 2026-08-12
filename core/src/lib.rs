//! The part of kleib3ry that has nothing to do with a window.
//!
//! Indexing a folder of books, keeping the index in SQLite, probing PDFs and
//! EPUBs for their metadata and cover art, and walking the `music/`, `artwork/`
//! and `video/` folders. No Tauri, no WebView, no GUI toolkit — which is the
//! whole point of it being its own crate.
//!
//! It was carved out of the desktop app when the container arrived. The desktop
//! shell and the HTTP server both want exactly these four modules and nothing
//! else, and building them through a crate that links GTK and WebKit meant a
//! Linux image carrying a browser engine in order to read a directory. Nothing
//! moved *logically*: `src-tauri/src/lib.rs` was already only commands, paths
//! and settings, and these modules never mentioned Tauri once.

pub mod db;
pub mod index;
pub mod media;
pub mod probe;

/// What can go wrong below the shell.
///
/// Deliberately without the shell's own failures in it: there is no `Tauri`
/// variant, because nothing in this crate can fail that way. The desktop app
/// wraps this in an error of its own that has one, and the server wraps it in a
/// status code — see each of them for the mapping.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("database: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("not a directory: {0}")]
    NotADirectory(String),
    #[error("no library folder has been chosen")]
    NoLibraryRoot,
    #[error("no book with id {0}")]
    UnknownBook(String),
    #[error("bad image data: {0}")]
    BadImage(String),
}

pub type Result<T> = std::result::Result<T, Error>;

/// The folder inside a library folder that holds everything the app owns.
///
/// Keeping the save files together in one named folder means the library folder
/// stays *your books* — one extra directory rather than app files scattered
/// among them — and the scanner skips it by name (see `index::SKIP_DIRS`) so
/// nothing in here is ever mistaken for a book.
pub const CONFIG_DIR: &str = ".library";

/// Where a library folder keeps the things the app writes.
///
/// One place for the whole layout, so the desktop shell and the server cannot
/// disagree about where a library is saved — which they did once, and the
/// symptom was a container that could not see the shelves you had arranged on
/// the desktop.
pub struct SaveFiles {
    /// The room, hand-edited, comments and all.
    pub world: std::path::PathBuf,
    /// Which book sits on which shelf. Machine-written, far too long to read.
    pub layout: std::path::PathBuf,
    /// Which lamps are on, whether it is night, whether it is raining. Its own
    /// file so deleting it brings back every light and the dry daylight.
    pub ambience: std::path::PathBuf,
    /// The book index. Derived: delete it and rescan.
    pub database: std::path::PathBuf,
    /// Rendered and extracted cover art, so copying a library copies its artwork.
    pub covers: std::path::PathBuf,
}

pub fn save_files(root: &std::path::Path) -> SaveFiles {
    let base = root.join(CONFIG_DIR);
    SaveFiles {
        world: base.join("library.json"),
        layout: base.join("books.json"),
        ambience: base.join("ambience.json"),
        database: base.join("index.sqlite"),
        covers: base.join("covers"),
    }
}

/// Changed-ness of a file, cheaply: modified time and length.
///
/// The front end polls this so that editing `library.json` in any editor reloads
/// the room. A stamp rather than the contents keeps the poll to a stat call, and
/// comparing both fields catches an edit that happens to preserve the length
/// within the same clock tick.
pub fn stamp_of(path: &std::path::Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis();
    Some(format!("{modified}:{}", meta.len()))
}

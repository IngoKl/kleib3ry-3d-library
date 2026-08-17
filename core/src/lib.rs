//! Indexing, the JSON index, format and tag probes, and the media folders.
//!
//! No Tauri, no WebView, no GUI toolkit: both the desktop shell and the HTTP
//! server want exactly these modules, and keeping them free of a GUI is what
//! lets the container be a binary rather than a Linux image carrying a browser
//! engine in order to read a directory.

pub mod catalog;
pub mod index;
pub mod media;
pub mod paper;
pub mod probe;

/// What can go wrong below the shell. No `Tauri` variant — nothing here can
/// fail that way. The desktop app wraps this in an error that has one; the
/// server maps it to a status code.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("not a directory: {0}")]
    NotADirectory(String),
    #[error("no library folder has been chosen")]
    NoLibraryRoot,
    #[error("no book with id {0}")]
    UnknownBook(String),
    #[error("bad image data: {0}")]
    BadImage(String),
    /// arXiv is the only network kleib3ry talks to — see `paper`.
    #[error("{0}")]
    Network(String),
    #[error("no paper on arXiv with id {0}")]
    UnknownPaper(String),
    #[error("that does not look like an arXiv id: {0}")]
    BadPaperId(String),
}

pub type Result<T> = std::result::Result<T, Error>;

/// The folder inside a library folder that holds everything the app owns, so
/// the rest of the folder stays the user's. Skipped by name when scanning (see
/// `index::SKIP_DIRS`).
pub const CONFIG_DIR: &str = ".library";

/// Where a library folder keeps the things the app writes. One definition, so
/// the desktop shell and the server cannot disagree about where a library is
/// saved.
pub struct SaveFiles {
    /// The room, hand-edited, comments and all.
    pub world: std::path::PathBuf,
    /// Which book sits on which shelf. Machine-written.
    pub layout: std::path::PathBuf,
    /// Lamps, night and weather. Its own file so deleting it resets them.
    pub ambience: std::path::PathBuf,
    /// Bookmarks and notes, by page number. Its own file, readable without the app.
    pub annotations: std::path::PathBuf,
    /// The book index. Derived: delete it and rescan.
    pub index: std::path::PathBuf,
    /// Rendered and extracted cover art, so copying a library copies its artwork.
    pub covers: std::path::PathBuf,
}

pub fn save_files(root: &std::path::Path) -> SaveFiles {
    let base = root.join(CONFIG_DIR);
    SaveFiles {
        world: base.join("library.json"),
        layout: base.join("books.json"),
        ambience: base.join("ambience.json"),
        annotations: base.join("annotations.json"),
        index: base.join("index.json"),
        covers: base.join("covers"),
    }
}

/// Write a save file by way of a sibling `.tmp` and a rename, so a crash or a
/// full disk mid-write leaves the old file whole instead of truncated.
pub fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut name = path.as_os_str().to_owned();
    name.push(".tmp");
    let tmp = std::path::PathBuf::from(name);
    std::fs::write(&tmp, bytes)?;
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        // Windows refuses to rename over a file another process holds open.
        // Remove-then-rename is not atomic, but narrower than writing in place.
        Err(_) if path.exists() => {
            std::fs::remove_file(path)?;
            std::fs::rename(&tmp, path)
        }
        Err(e) => Err(e),
    }
}

/// Changed-ness of a file, cheaply: modified time and length. Polled by the
/// front end for live reload — a stamp keeps that to a stat call, and both
/// fields together catch a same-length edit inside one clock tick.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_atomic_replaces_the_target_and_leaves_no_tmp_behind() {
        let dir = std::env::temp_dir().join("kleib3ry-core-atomic");
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("save.json");

        // Missing parents are created.
        write_atomic(&path, b"{\"a\":1}").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"{\"a\":1}");

        write_atomic(&path, b"{\"a\":2}").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"{\"a\":2}");
        assert!(!dir.join("save.json.tmp").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }
}

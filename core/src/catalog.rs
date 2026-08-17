//! The book index: what the last scan found, kept as JSON beside the books.
//!
//! A *cache*: every field is recovered by rescanning, and the documented repair
//! is to delete the file. JSON rather than a database because the library
//! folder is the save file — plain text diffs cleanly in version control, reads
//! without the app, and leaves no side files for a sync client to half-copy.
//!
//! Paths are relative to the library root, so copying a folder to another
//! machine or OS strands nothing.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::Error;

type Result<T> = std::result::Result<T, Error>;

/// Cover art extensions, best first. A book can have both an extracted cover
/// and a rendered one; the order decides which wins, so the choice is stable
/// rather than whatever the directory listing happened to yield.
pub const COVER_EXTENSIONS: [&str; 5] = ["jpg", "png", "gif", "webp", "svg"];

/// Windows refuses — or worse, aliases to a device — these as file names, so an
/// id spelling one is unusable on any machine the library might sync to.
fn is_reserved_name(id: &str) -> bool {
    let upper = id.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (upper.len() == 4
            && (upper.starts_with("COM") || upper.starts_with("LPT"))
            && matches!(upper.as_bytes()[3], b'1'..=b'9'))
}

/// Whether an id may become a file name in the cover cache.
///
/// A rendered cover's id arrives from the WebView — over IPC on the desktop, in
/// a URL on the server — and `Path::join` follows `..` and absolute paths, so
/// anything that is not a plain name would write outside the cache. Here rather
/// than in either shell because both need exactly this check and a guard that
/// exists twice is a guard that can come to mean two things.
pub fn is_cover_id(id: &str) -> bool {
    !id.is_empty()
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && !is_reserved_name(id)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Pdf,
    Epub,
}

impl Format {
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_ascii_lowercase().as_str() {
            "pdf" => Some(Self::Pdf),
            "epub" => Some(Self::Epub),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            Self::Epub => "epub",
        }
    }
}

/// A book as the front end sees it. `path` is absolute and `cover` is a
/// cache-relative file name, not a URL -- turning it into something loadable is
/// the driver's job.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub path: String,
    pub format: Format,
    pub title: String,
    pub author: Option<String>,
    pub cover: Option<String>,
    pub page_count: Option<u32>,
    pub size_bytes: u64,
}

/// One book as the index file records it.
///
/// No cover: that is derived from the cache directory instead (see
/// [`Catalog::list_books`]). No indexed-at: nothing ever read it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Relative to the library root, with forward slashes on every platform.
    pub path: String,
    pub format: Format,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_count: Option<u32>,
    pub size_bytes: u64,
    /// Milliseconds, matching `stamp_of`.
    pub mtime: i64,
    pub probe_version: i64,
}

/// Everything the last scan found, keyed by book id.
///
/// A `BTreeMap` rather than a list so the file is byte-identical for identical
/// content: a diff is then exactly the books that changed, and a rescan that
/// finds nothing new writes nothing at all.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    #[serde(default)]
    books: BTreeMap<String, Entry>,
}

impl Catalog {
    /// Read the index. A missing file is an empty index -- that is a library
    /// that has not been scanned yet, not an error.
    ///
    /// A file that does not parse *is* an error, and deliberately: the index is
    /// meant to be hand-editable, and a typo must stop the app rather than be
    /// silently overwritten with a fresh scan. Deleting it is the reset.
    pub fn load(path: &Path) -> Result<Self> {
        match std::fs::read(path) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.into()),
        }
    }

    fn to_json(&self) -> Result<String> {
        let mut text = serde_json::to_string_pretty(self)?;
        text.push('\n');
        Ok(text)
    }

    /// Write the index, atomically, and only if it changed.
    ///
    /// Skipping an identical write leaves even the modified time alone, so a
    /// rescan of an unchanged library gives a sync client nothing to copy.
    pub fn save(&self, path: &Path) -> Result<()> {
        let text = self.to_json()?;
        if std::fs::read_to_string(path).map(|old| old == text).unwrap_or(false) {
            return Ok(());
        }
        crate::write_atomic(path, text.as_bytes())?;
        Ok(())
    }

    /// Record a freshly probed book. `rel_path` comes from [`relative_path`].
    pub fn upsert(&mut self, book: &Book, rel_path: &str, mtime: i64) {
        // A file replaced in place gets a new id but keeps its path. The old
        // entry describes content that is no longer there, so it goes; if that
        // content still exists elsewhere, the same walk re-adds it under its
        // own id.
        self.books.retain(|id, entry| id == &book.id || entry.path != rel_path);
        self.books.insert(
            book.id.clone(),
            Entry {
                path: rel_path.to_string(),
                format: book.format,
                title: book.title.clone(),
                author: book.author.clone(),
                page_count: book.page_count,
                size_bytes: book.size_bytes,
                mtime,
                probe_version: crate::probe::PROBE_VERSION,
            },
        );
    }

    /// Keep the stored path in step with a file that moved without changing.
    ///
    /// `is_current` matches on content identity alone, so a renamed or moved
    /// book skips re-probing -- but the entry would keep pointing at the dead
    /// old path and the book could never be opened again. Any other entry
    /// squatting on the destination is dropped: it describes a file that is
    /// gone or moved, and the same scan re-adds or prunes it.
    pub fn refresh_path(&mut self, id: &str, rel_path: &str) {
        let moved = self.books.get(id).map(|e| e.path != rel_path).unwrap_or(false);
        if !moved {
            return;
        }
        self.books.retain(|other, entry| other == id || entry.path != rel_path);
        if let Some(entry) = self.books.get_mut(id) {
            entry.path = rel_path.to_string();
        }
    }

    /// True when the file on disk is unchanged since the last index *and* the
    /// entry was written by the current probes, so the expensive probe can be
    /// skipped. `mtime` is in milliseconds -- whole seconds missed a
    /// same-length rewrite landing within one clock second.
    ///
    /// The probe version is part of it because a file that has not changed can
    /// still be described wrongly: an entry written before the EPUB probe
    /// measured length carries no page count, and no amount of rescanning would
    /// ever have replaced it.
    pub fn is_current(&self, id: &str, size: u64, mtime: i64) -> bool {
        self.books
            .get(id)
            .map(|e| {
                e.size_bytes == size
                    && e.mtime == mtime
                    && e.probe_version == crate::probe::PROBE_VERSION
            })
            .unwrap_or(false)
    }

    /// Drop entries whose file is no longer on disk. Returns the removed ids so
    /// their cover files can be cleaned up too.
    ///
    /// `unreadable` is the paths the scan found but could not open — a lock held
    /// by a sync client or antivirus, not a deletion. A book that both moved and
    /// was unreadable this scan looks exactly like a deletion: its stored path
    /// is gone and nothing ties the entry to the locked file at the new path.
    /// Rather than guess, skip the prune entirely when anything was unreadable —
    /// a stale entry self-heals on the next clean scan, a book that lost its
    /// place on your shelves does not.
    pub fn prune_missing(&mut self, seen: &[String], unreadable: &[String]) -> Vec<String> {
        if !unreadable.is_empty() {
            return Vec::new();
        }

        let seen: HashSet<&str> = seen.iter().map(String::as_str).collect();
        let gone: Vec<String> = self
            .books
            .keys()
            .filter(|id| !seen.contains(id.as_str()))
            .cloned()
            .collect();

        for id in &gone {
            self.books.remove(id);
        }
        gone
    }

    pub fn contains(&self, id: &str) -> bool {
        self.books.contains_key(id)
    }

    pub fn len(&self) -> usize {
        self.books.len()
    }

    pub fn is_empty(&self) -> bool {
        self.books.is_empty()
    }

    /// Where a book actually is on this machine.
    pub fn path_of(&self, root: &Path, id: &str) -> Option<PathBuf> {
        self.books.get(id).map(|e| root.join(&e.path))
    }

    /// Every book, in listing order, with absolute paths and covers filled in.
    ///
    /// The cover is derived from what is in the cache rather than stored, which
    /// leaves the scan the index file's only writer: a cover rendered by the
    /// front end lands on disk and simply shows up in the next listing. It also
    /// means a re-probe that finds no cover cannot lose one that was rendered
    /// earlier, because the file is the record.
    pub fn list_books(&self, root: &Path, covers_dir: &Path) -> Vec<Book> {
        let covers = covers_on_disk(covers_dir);
        let mut books: Vec<Book> = self
            .books
            .iter()
            .map(|(id, entry)| Book {
                id: id.clone(),
                path: root.join(&entry.path).to_string_lossy().to_string(),
                format: entry.format,
                title: entry.title.clone(),
                author: entry.author.clone(),
                cover: covers.get(id).cloned(),
                page_count: entry.page_count,
                size_bytes: entry.size_bytes,
            })
            .collect();

        // Unattributed books last, then by author, then by title.
        books.sort_by(|a, b| {
            a.author
                .is_none()
                .cmp(&b.author.is_none())
                .then_with(|| a.author.cmp(&b.author))
                .then_with(|| a.title.cmp(&b.title))
        });
        books
    }
}

/// The cover cache as a map from book id to file name.
///
/// One directory read rather than a `stat` per book per extension: this runs on
/// load and after a scan, never per frame.
fn covers_on_disk(covers_dir: &Path) -> HashMap<String, String> {
    let mut best: HashMap<String, (usize, String)> = HashMap::new();
    let Ok(entries) = std::fs::read_dir(covers_dir) else {
        return HashMap::new();
    };

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some((id, ext)) = name.rsplit_once('.') else { continue };
        let ext = ext.to_ascii_lowercase();
        let Some(rank) = COVER_EXTENSIONS.iter().position(|e| *e == ext) else { continue };

        let better = best.get(id).map(|(seen, _)| rank < *seen).unwrap_or(true);
        if better {
            best.insert(id.to_string(), (rank, name));
        }
    }

    best.into_iter().map(|(id, (_, name))| (id, name)).collect()
}

/// A path as the index stores it: relative to the library root, with forward
/// slashes so the same book reads the same on either operating system.
///
/// Rebuilding is `root.join(...)`, which accepts forward slashes on Windows
/// too. A path outside the root — which `discover` cannot produce, but a
/// hand-edited index could name — stays absolute and native, and `join` on an
/// absolute path yields it unchanged, so it still resolves.
pub fn relative_path(root: &Path, path: &Path) -> String {
    let Ok(rel) = path.strip_prefix(root) else {
        return path.to_string_lossy().to_string();
    };
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kleib3ry-catalog-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample(id: &str, title: &str) -> Book {
        Book {
            id: id.to_string(),
            path: format!("/books/{title}.epub"),
            format: Format::Epub,
            title: title.to_string(),
            author: Some("A. Writer".into()),
            cover: Some(format!("{id}.jpg")),
            page_count: Some(120),
            size_bytes: 4096,
        }
    }

    fn rel(title: &str) -> String {
        format!("books/{title}.epub")
    }

    /// An index written before the probes learned something has to be
    /// re-probed, or the improvement never reaches a library already indexed.
    #[test]
    fn an_entry_from_an_older_probe_is_not_current() {
        let mut cat = Catalog::default();
        cat.upsert(&sample("a", "First"), &rel("First"), 10);
        assert!(cat.is_current("a", 4096, 10));

        cat.books.get_mut("a").unwrap().probe_version = 0;
        assert!(!cat.is_current("a", 4096, 10));
    }

    #[test]
    fn upsert_replaces_rather_than_duplicating() {
        let mut cat = Catalog::default();
        cat.upsert(&sample("a", "First"), &rel("First"), 10);
        cat.upsert(&sample("a", "First, Revised"), "books/moved.epub", 20);

        let books = cat.list_books(Path::new("/lib"), Path::new("/nowhere"));
        assert_eq!(books.len(), 1);
        assert_eq!(books[0].title, "First, Revised");
        assert!(books[0].path.replace('\\', "/").ends_with("books/moved.epub"));
    }

    #[test]
    fn is_current_tracks_size_and_mtime() {
        let mut cat = Catalog::default();
        cat.upsert(&sample("a", "First"), &rel("First"), 10);

        assert!(cat.is_current("a", 4096, 10));
        assert!(!cat.is_current("a", 4096, 11));
        assert!(!cat.is_current("a", 999, 10));
        assert!(!cat.is_current("missing", 4096, 10));
    }

    #[test]
    fn prune_removes_only_unseen_entries() {
        let mut cat = Catalog::default();
        cat.upsert(&sample("a", "Kept"), &rel("Kept"), 10);
        cat.upsert(&sample("b", "Gone"), &rel("Gone"), 10);

        let removed = cat.prune_missing(&["a".to_string()], &[]);
        assert_eq!(removed, vec!["b".to_string()]);
        assert_eq!(cat.len(), 1);
    }

    #[test]
    fn prune_spares_files_that_merely_could_not_be_read() {
        let mut cat = Catalog::default();
        cat.upsert(&sample("a", "Kept"), &rel("Kept"), 10);
        cat.upsert(&sample("b", "Locked"), &rel("Locked"), 10);

        let removed = cat.prune_missing(&["a".to_string()], &[rel("Locked")]);
        assert_eq!(removed, Vec::<String>::new());
        assert_eq!(cat.len(), 2);
    }

    /// A book that moved *and* was unreadable this scan: its stored path is
    /// gone and the unreadable path does not match the entry. Nothing may be
    /// pruned, or the move would cost the book its place on the shelves.
    #[test]
    fn an_unreadable_scan_prunes_nothing_at_all() {
        let mut cat = Catalog::default();
        cat.upsert(&sample("a", "Kept"), &rel("Kept"), 10);
        cat.upsert(&sample("b", "Moved Then Locked"), &rel("Moved Then Locked"), 10);

        let removed = cat.prune_missing(&["a".to_string()], &["books/new-place.epub".to_string()]);
        assert_eq!(removed, Vec::<String>::new());
        assert_eq!(cat.len(), 2);
    }

    #[test]
    fn a_moved_file_keeps_its_entry_but_follows_its_path() {
        let mut cat = Catalog::default();
        cat.upsert(&sample("a", "First"), &rel("First"), 10);

        cat.refresh_path("a", "books/filed/First.epub");
        assert_eq!(cat.path_of(Path::new("/lib"), "a"), Some(PathBuf::from("/lib").join("books/filed/First.epub")));
        // The same call with the path already current is a no-op.
        cat.refresh_path("a", "books/filed/First.epub");
        assert_eq!(cat.len(), 1);
    }

    #[test]
    fn replacing_a_file_in_place_swaps_the_entry_rather_than_duplicating() {
        let mut cat = Catalog::default();
        cat.upsert(&sample("a", "Old Edition"), &rel("Old Edition"), 10);

        // Same path, new content: a different id landing on a taken path.
        cat.upsert(&sample("b", "New Edition"), &rel("Old Edition"), 20);

        let books = cat.list_books(Path::new("/lib"), Path::new("/nowhere"));
        assert_eq!(books.len(), 1);
        assert_eq!(books[0].id, "b");
    }

    #[test]
    fn listing_sorts_unattributed_books_last() {
        let mut cat = Catalog::default();
        let mut anon = sample("a", "Anonymous");
        anon.author = None;
        cat.upsert(&anon, &rel("Anonymous"), 10);
        cat.upsert(&sample("b", "Attributed"), &rel("Attributed"), 10);

        let titles: Vec<_> = cat
            .list_books(Path::new("/lib"), Path::new("/nowhere"))
            .into_iter()
            .map(|b| b.title)
            .collect();
        assert_eq!(titles, vec!["Attributed", "Anonymous"]);
    }

    #[test]
    fn a_missing_file_loads_empty() {
        let dir = temp_dir("missing");
        let cat = Catalog::load(&dir.join("index.json")).unwrap();
        assert!(cat.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = temp_dir("round-trip");
        let path = dir.join("index.json");

        let mut cat = Catalog::default();
        cat.upsert(&sample("a", "First"), &rel("First"), 10);
        let mut anon = sample("b", "Anonymous");
        anon.author = None;
        anon.page_count = None;
        cat.upsert(&anon, &rel("Anonymous"), 20);
        cat.save(&path).unwrap();

        let back = Catalog::load(&path).unwrap();
        assert_eq!(back.len(), 2);
        assert!(back.is_current("a", 4096, 10));
        assert!(back.is_current("b", 4096, 20));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The whole point of JSON over a database: an unchanged library produces
    /// an unchanged file, so version control shows only the books that moved.
    #[test]
    fn saving_twice_is_byte_identical() {
        let dir = temp_dir("deterministic");
        let path = dir.join("index.json");

        let mut cat = Catalog::default();
        for (id, title) in [("c", "Third"), ("a", "First"), ("b", "Second")] {
            cat.upsert(&sample(id, title), &rel(title), 10);
        }
        cat.save(&path).unwrap();
        let first = std::fs::read(&path).unwrap();

        // Built in a different order, it must still serialise the same.
        let mut again = Catalog::default();
        for (id, title) in [("b", "Second"), ("c", "Third"), ("a", "First")] {
            again.upsert(&sample(id, title), &rel(title), 10);
        }
        let second = again.to_json().unwrap();

        assert_eq!(String::from_utf8(first).unwrap(), second);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn paths_are_stored_relative_with_forward_slashes() {
        let root = Path::new("/lib");
        let deep = Path::new("/lib").join("books").join("essays").join("two.epub");
        assert_eq!(relative_path(root, &deep), "books/essays/two.epub");

        // Outside the root: kept whole, and still resolvable by `join`.
        let outside = Path::new("/elsewhere/loose.pdf");
        let stored = relative_path(root, outside);
        assert_eq!(root.join(&stored), outside);
    }

    /// The guard both shells write a cover through. Traversal, absolute paths and
    /// the Windows device names all have to be refused in one place, not two.
    #[test]
    fn a_cover_id_is_a_plain_name_and_nothing_else() {
        assert!(is_cover_id("239516aa5c3083e3"));
        assert!(is_cover_id("a-b_c"));

        assert!(!is_cover_id(""));
        assert!(!is_cover_id("../escape"));
        assert!(!is_cover_id("with/slash"));
        assert!(!is_cover_id("with.dot"));
        // Reserved on Windows, in any casing, with or without an extension to come.
        for reserved in ["CON", "con", "NUL", "com1", "LPT9"] {
            assert!(!is_cover_id(reserved), "{reserved} was accepted");
        }
        // Only the four-character forms are reserved; these are ordinary names.
        assert!(is_cover_id("COM"));
        assert!(is_cover_id("COM10"));
        assert!(is_cover_id("COM0"));
    }

    /// A hand edit with a typo in it must not cost you the index.
    #[test]
    fn a_file_that_does_not_parse_is_an_error_not_a_wipe() {
        let dir = temp_dir("broken");
        let path = dir.join("index.json");
        std::fs::write(&path, b"{ \"books\": { oops }").unwrap();

        assert!(Catalog::load(&path).is_err());
        assert!(path.exists(), "a broken index must be left alone, not replaced");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The cover lives on disk, not in the index, so a re-probe that extracts
    /// nothing cannot lose one the front end rendered earlier.
    #[test]
    fn a_cover_on_disk_surfaces_and_survives_a_reprobe() {
        let dir = temp_dir("covers");
        let covers = dir.join("covers");
        std::fs::create_dir_all(&covers).unwrap();
        std::fs::write(covers.join("a.png"), b"pretend png").unwrap();

        let mut cat = Catalog::default();
        cat.upsert(&sample("a", "First"), &rel("First"), 10);
        assert_eq!(cat.list_books(&dir, &covers)[0].cover.as_deref(), Some("a.png"));

        // Re-probed, finding no cover of its own.
        let mut without = sample("a", "First");
        without.cover = None;
        cat.upsert(&without, &rel("First"), 20);
        assert_eq!(cat.list_books(&dir, &covers)[0].cover.as_deref(), Some("a.png"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Both an extracted and a rendered cover can exist; the winner must not
    /// depend on directory order.
    #[test]
    fn the_best_cover_extension_wins_stably() {
        let dir = temp_dir("cover-order");
        let covers = dir.join("covers");
        std::fs::create_dir_all(&covers).unwrap();
        std::fs::write(covers.join("a.png"), b"x").unwrap();
        std::fs::write(covers.join("a.jpg"), b"x").unwrap();
        std::fs::write(covers.join("a.txt"), b"not a cover").unwrap();

        let mut cat = Catalog::default();
        cat.upsert(&sample("a", "First"), &rel("First"), 10);
        assert_eq!(cat.list_books(&dir, &covers)[0].cover.as_deref(), Some("a.jpg"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}

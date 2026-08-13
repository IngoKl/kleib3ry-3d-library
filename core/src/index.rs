use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::db::{self, Book, Format};
use crate::probe;
use crate::Error;

type Result<T> = std::result::Result<T, Error>;

/// How much of a file feeds the identity hash. Enough to separate two different
/// books of the same length, cheap enough to run over thousands of files.
const ID_SAMPLE_BYTES: usize = 64 * 1024;

/// Skip directories that are never a user's library but are often enormous.
/// `.library` is ours — the room document and the book layout live there, and a
/// scan must never look inside its own save folder.
const SKIP_DIRS: [&str; 7] = [
    ".library",
    "node_modules",
    ".git",
    ".svn",
    "$RECYCLE.BIN",
    "System Volume Information",
    ".cache",
];

/// Where books live inside a library folder.
const BOOKS_DIR: &str = "books";

/// The other things a library folder holds, by the same convention: records for
/// the player, pictures for the walls, tapes for the television, ROMs for the
/// arcade machine. None of them is ever a book.
const RESERVED_DIRS: [&str; 4] = ["music", "artwork", "video", "roms"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub done: u32,
    pub total: u32,
    pub current: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub found: u32,
    pub added: u32,
    pub unchanged: u32,
    pub removed: u32,
    pub failed: u32,
}

/// Stable identity for a file: its length plus its opening bytes.
///
/// Deliberately not the path, so renaming or moving a book keeps its reading
/// progress and its place on your shelves. Two byte-identical files collapse to
/// one entry, which is the behaviour you want for a duplicate.
pub fn book_id(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let len = file.metadata()?.len();

    let mut head = vec![0u8; ID_SAMPLE_BYTES];
    let read = read_up_to(&mut file, &mut head)?;
    head.truncate(read);

    let mut hasher = Sha256::new();
    hasher.update(len.to_le_bytes());
    hasher.update(&head);
    Ok(hex16(&hasher.finalize()))
}

fn read_up_to(file: &mut fs::File, buf: &mut [u8]) -> Result<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        match file.read(&mut buf[filled..])? {
            0 => break,
            n => filled += n,
        }
    }
    Ok(filled)
}

fn hex16(bytes: &[u8]) -> String {
    bytes.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

fn modified_seconds(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// The folder a scan of `root` will actually read, and `None` when that is the
/// library folder itself.
///
/// A library folder is more than books — `music/` for the record player,
/// `artwork/` for what hangs on the walls, `.library/` for the app's own save —
/// so indexing is confined to `books/` as soon as that folder exists. A folder
/// from before the convention, with books lying loose at the top level, is
/// still read whole: refusing to index it would look like the app having lost
/// the collection.
pub fn books_root(root: &Path) -> Option<PathBuf> {
    let books = root.join(BOOKS_DIR);
    books.is_dir().then_some(books)
}

/// Every readable book file under `root`, depth-limited so a mis-click on `C:\`
/// does not walk the entire disk.
pub fn discover(root: &Path) -> Vec<(PathBuf, Format)> {
    let books = books_root(root);
    let start = books.as_deref().unwrap_or(root);
    // Only worth filtering when reading the library folder whole. Inside
    // `books/`, a folder called `music` is books about music.
    let guard_reserved = books.is_none();

    WalkDir::new(start)
        .max_depth(12)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            let Some(name) = entry.file_name().to_str() else { return true };
            if SKIP_DIRS.contains(&name) {
                return false;
            }
            !(guard_reserved && entry.depth() == 1 && RESERVED_DIRS.contains(&name))
        })
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| {
            let path = entry.into_path();
            let format = path
                .extension()
                .and_then(|e| e.to_str())
                .and_then(Format::from_extension)?;
            Some((path, format))
        })
        .collect()
}

/// Run a parser with a net under it.
///
/// `lopdf` and `zip` are given whatever the user happens to have on disk, and
/// malformed files make them panic rather than return an error. One bad book in
/// a collection of thousands must not end the scan — or, with an aborting
/// profile, the process.
fn guard<T>(what: impl FnOnce() -> T) -> Option<T> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(what)).ok()
}

/// Probe one file and write its cover into the cache. Never panics on a bad
/// file: a book that fails to parse still gets an entry from its filename.
pub fn index_one(path: &Path, format: Format, covers_dir: &Path) -> Result<Book> {
    let meta = fs::metadata(path)?;
    let id = book_id(path)?;

    let probed = guard(|| match format {
        Format::Epub => match fs::read(path) {
            Ok(bytes) => probe::epub::probe(&bytes),
            Err(_) => probe::Probed::default(),
        },
        Format::Pdf => probe::pdf::probe(path),
    })
    .unwrap_or_default();

    let cover = probed.cover.and_then(|image| {
        let name = format!("{id}.{}", image.ext);
        fs::create_dir_all(covers_dir).ok()?;
        fs::write(covers_dir.join(&name), &image.bytes).ok()?;
        Some(name)
    });

    Ok(Book {
        id,
        path: path.to_string_lossy().to_string(),
        format,
        title: probed.title.unwrap_or_else(|| probe::title_from_filename(path)),
        author: probed.author,
        cover,
        page_count: probed.page_count,
        size_bytes: meta.len(),
        indexed_at: now_seconds(),
    })
}

/// Walk the library folder's `books/` — or the whole folder, if it has none —
/// and bring the database in line with it.
///
/// `on_progress` is called as each file is handled so the UI can show something
/// during what may be a multi-minute scan of a large collection.
pub fn scan(
    root: &Path,
    db_path: &Path,
    covers_dir: &Path,
    mut on_progress: impl FnMut(ScanProgress),
) -> Result<ScanSummary> {
    let conn = db::open(db_path)?;
    let files = discover(root);

    let mut summary = ScanSummary { found: files.len() as u32, ..Default::default() };
    let mut seen = Vec::with_capacity(files.len());
    // Files the walk found but could not open — a sync client's lock, not a
    // deletion. Remembered so the prune below leaves their rows (and reading
    // progress) alone.
    let mut unreadable = Vec::new();

    // Autocommit would fsync once per book — thousands of commits on a first
    // scan. Batched commits keep the scan fast while still letting a cover
    // save from the WebView get a turn between chunks.
    const COMMIT_EVERY: u32 = 64;
    let mut writes = 0u32;
    conn.execute_batch("BEGIN")?;

    for (i, (path, format)) in files.iter().enumerate() {
        on_progress(ScanProgress {
            done: i as u32,
            total: summary.found,
            current: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        });

        let Ok(meta) = fs::metadata(path) else {
            summary.failed += 1;
            unreadable.push(path.to_string_lossy().to_string());
            continue;
        };
        let Ok(id) = book_id(path) else {
            summary.failed += 1;
            unreadable.push(path.to_string_lossy().to_string());
            continue;
        };
        seen.push(id.clone());

        let mtime = modified_seconds(&meta);
        if db::is_current(&conn, &id, meta.len(), mtime)? {
            // Unchanged content can still have moved; the stored path must
            // follow it or the book can never be opened again.
            db::refresh_path(&conn, &id, &path.to_string_lossy())?;
            summary.unchanged += 1;
            continue;
        }

        match guard(|| index_one(path, *format, covers_dir)) {
            Some(Ok(book)) => {
                db::upsert_book(&conn, &book, mtime)?;
                summary.added += 1;
                writes += 1;
                if writes % COMMIT_EVERY == 0 {
                    conn.execute_batch("COMMIT; BEGIN")?;
                }
            }
            // Either the probe returned an error or it panicked outright.
            Some(Err(_)) | None => summary.failed += 1,
        }
    }

    let removed = db::prune_missing(&conn, &seen, &unreadable)?;
    conn.execute_batch("COMMIT")?;
    for id in &removed {
        // Best effort: a leftover cover is harmless, a failed scan is not.
        for ext in ["jpg", "png", "gif", "webp", "svg"] {
            fs::remove_file(covers_dir.join(format!("{id}.{ext}"))).ok();
        }
    }
    summary.removed = removed.len() as u32;

    on_progress(ScanProgress {
        done: summary.found,
        total: summary.found,
        current: String::new(),
    });

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kleib3ry-index-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn identity_follows_content_not_path() {
        let dir = temp_dir("identity");
        let a = dir.join("a.pdf");
        let b = dir.join("renamed.pdf");
        fs::write(&a, b"the same bytes").unwrap();
        fs::write(&b, b"the same bytes").unwrap();
        let c = dir.join("c.pdf");
        fs::write(&c, b"different bytes").unwrap();

        assert_eq!(book_id(&a).unwrap(), book_id(&b).unwrap());
        assert_ne!(book_id(&a).unwrap(), book_id(&c).unwrap());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn discover_finds_books_and_ignores_everything_else() {
        let dir = temp_dir("discover");
        fs::create_dir_all(dir.join("sub/node_modules")).unwrap();
        // The app's own save folder, which must never be scanned as content.
        fs::create_dir_all(dir.join(".library")).unwrap();
        fs::write(dir.join("one.pdf"), b"x").unwrap();
        fs::write(dir.join("sub/two.EPUB"), b"x").unwrap();
        fs::write(dir.join("notes.txt"), b"x").unwrap();
        fs::write(dir.join("sub/node_modules/three.pdf"), b"x").unwrap();
        fs::write(dir.join(".library/four.pdf"), b"x").unwrap();

        let mut found: Vec<String> = discover(&dir)
            .into_iter()
            .map(|(p, _)| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        found.sort();

        assert_eq!(found, vec!["one.pdf", "two.EPUB"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_books_folder_confines_the_scan_to_itself() {
        let dir = temp_dir("books-folder");
        fs::create_dir_all(dir.join("books/essays")).unwrap();
        fs::create_dir_all(dir.join("music")).unwrap();
        fs::create_dir_all(dir.join("artwork")).unwrap();
        fs::write(dir.join("books/one.pdf"), b"x").unwrap();
        fs::write(dir.join("books/essays/two.epub"), b"x").unwrap();
        // Everything outside `books/` belongs to something else — the record
        // player, the walls — or is simply not filed yet.
        fs::write(dir.join("music/sleeve-notes.pdf"), b"x").unwrap();
        fs::write(dir.join("artwork/catalogue.pdf"), b"x").unwrap();
        fs::write(dir.join("loose.pdf"), b"x").unwrap();

        let mut found: Vec<String> = discover(&dir)
            .into_iter()
            .map(|(p, _)| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        found.sort();

        assert_eq!(found, vec!["one.pdf", "two.epub"]);
        assert_eq!(books_root(&dir), Some(dir.join("books")));
        let _ = fs::remove_dir_all(&dir);
    }

    /// A `music` folder nested *inside* `books/` is books about music, and the
    /// name is only reserved at the top of a library folder.
    #[test]
    fn the_reserved_names_only_apply_at_the_top_level() {
        let dir = temp_dir("reserved-nested");
        fs::create_dir_all(dir.join("books/music")).unwrap();
        fs::write(dir.join("books/music/on_bach.pdf"), b"x").unwrap();

        let found: Vec<String> = discover(&dir)
            .into_iter()
            .map(|(p, _)| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();

        assert_eq!(found, vec!["on_bach.pdf"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_folder_with_no_books_directory_is_still_read_whole() {
        let dir = temp_dir("no-books-folder");
        fs::create_dir_all(dir.join("essays")).unwrap();
        fs::create_dir_all(dir.join("music")).unwrap();
        fs::create_dir_all(dir.join("roms")).unwrap();
        fs::write(dir.join("one.pdf"), b"x").unwrap();
        fs::write(dir.join("essays/two.epub"), b"x").unwrap();
        fs::write(dir.join("music/sleeve-notes.pdf"), b"x").unwrap();
        fs::write(dir.join("roms/manual.pdf"), b"x").unwrap();

        let mut found: Vec<String> = discover(&dir)
            .into_iter()
            .map(|(p, _)| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        found.sort();

        assert_eq!(found, vec!["one.pdf", "two.epub"]);
        assert_eq!(books_root(&dir), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_that_cannot_be_parsed_still_gets_a_title() {
        let dir = temp_dir("unparseable");
        let path = dir.join("the_hobbit_(1937).pdf");
        fs::write(&path, b"not really a pdf").unwrap();

        let book = index_one(&path, Format::Pdf, &dir.join("covers")).unwrap();
        assert_eq!(book.title, "The Hobbit 1937");
        assert_eq!(book.cover, None);
        assert_eq!(book.page_count, None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scanning_twice_reports_everything_unchanged() {
        let dir = temp_dir("rescan");
        let covers = dir.join("covers");
        let db_path = dir.join("library.sqlite");
        fs::write(dir.join("one.pdf"), b"pretend pdf").unwrap();
        fs::write(dir.join("two.epub"), b"pretend epub").unwrap();

        let first = scan(&dir, &db_path, &covers, |_| {}).unwrap();
        assert_eq!((first.found, first.added, first.unchanged), (2, 2, 0));

        let second = scan(&dir, &db_path, &covers, |_| {}).unwrap();
        assert_eq!((second.found, second.added, second.unchanged), (2, 0, 2));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_deleted_file_is_pruned_on_the_next_scan() {
        let dir = temp_dir("prune");
        let covers = dir.join("covers");
        let db_path = dir.join("library.sqlite");
        fs::write(dir.join("keep.pdf"), b"keep me").unwrap();
        fs::write(dir.join("drop.pdf"), b"drop me").unwrap();

        scan(&dir, &db_path, &covers, |_| {}).unwrap();
        fs::remove_file(dir.join("drop.pdf")).unwrap();

        let after = scan(&dir, &db_path, &covers, |_| {}).unwrap();
        assert_eq!(after.removed, 1);

        let conn = db::open(&db_path).unwrap();
        assert_eq!(db::count_books(&conn).unwrap(), 1);

        // Windows will not delete a directory while the database is still open.
        drop(conn);
        let _ = fs::remove_dir_all(&dir);
    }

    /// The library folder is someone's actual book collection. Indexing reads
    /// it and writes nothing of its own accord — it only ever writes where the
    /// caller points it. The companion test below covers the case that matters
    /// in practice, where the caller points it inside the library folder.
    #[test]
    fn scanning_never_modifies_the_library_folder() {
        let library = temp_dir("readonly-library");
        let appdata = temp_dir("readonly-appdata");

        fs::create_dir_all(library.join("essays")).unwrap();
        fs::write(library.join("one.pdf"), b"pretend pdf").unwrap();
        fs::write(library.join("essays/two.epub"), b"pretend epub").unwrap();
        fs::write(library.join("notes.txt"), b"leave me alone").unwrap();

        let snapshot = |root: &Path| -> Vec<(String, u64, i64)> {
            let mut entries: Vec<_> = WalkDir::new(root)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_file())
                .map(|e| {
                    let meta = e.metadata().unwrap();
                    (
                        e.path().strip_prefix(root).unwrap().to_string_lossy().to_string(),
                        meta.len(),
                        modified_seconds(&meta),
                    )
                })
                .collect();
            entries.sort();
            entries
        };

        let before = snapshot(&library);
        scan(&library, &appdata.join("library.sqlite"), &appdata.join("covers"), |_| {}).unwrap();
        // A second pass also exercises the prune path, which is the only place
        // the indexer deletes anything at all.
        scan(&library, &appdata.join("library.sqlite"), &appdata.join("covers"), |_| {}).unwrap();
        let after = snapshot(&library);

        assert_eq!(before, after, "the scan changed files in the library folder");

        let _ = fs::remove_dir_all(&library);
        let _ = fs::remove_dir_all(&appdata);
    }

    #[test]
    fn a_panicking_parser_is_contained() {
        // Silence the default hook so the expected panic does not look like a
        // test failure in the output.
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let caught = guard(|| -> u32 { panic!("malformed book") });
        std::panic::set_hook(previous);

        assert_eq!(caught, None);
        assert_eq!(guard(|| 7), Some(7));
    }

    #[test]
    fn progress_runs_from_zero_to_the_total() {
        let dir = temp_dir("progress");
        fs::write(dir.join("a.pdf"), b"a").unwrap();
        fs::write(dir.join("b.pdf"), b"b").unwrap();

        let mut seen = Vec::new();
        scan(&dir, &dir.join("db.sqlite"), &dir.join("covers"), |p| {
            seen.push((p.done, p.total))
        })
        .unwrap();

        assert_eq!(seen.first(), Some(&(0, 2)));
        assert_eq!(seen.last(), Some(&(2, 2)));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cover_cache_inside_the_library_folder_stays_inside_dot_library() {
        let library = temp_dir("covers-in-library");
        fs::create_dir_all(library.join("essays")).unwrap();
        fs::write(library.join("one.pdf"), b"pretend pdf").unwrap();
        fs::write(library.join("essays/two.epub"), b"pretend epub").unwrap();
        fs::write(library.join("notes.txt"), b"leave me alone").unwrap();

        let books = |root: &Path| -> Vec<String> {
            let mut found: Vec<String> = WalkDir::new(root)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_file())
                .map(|e| e.path().strip_prefix(root).unwrap().to_string_lossy().to_string())
                .filter(|p| !p.replace(std::path::MAIN_SEPARATOR, "/").starts_with(".library/"))
                .collect();
            found.sort();
            found
        };

        let before = books(&library);
        // Covers now cache beside the library rather than in the app's own data
        // directory. Everything the app writes must stay under `.library/`.
        let save = library.join(".library");
        let covers = save.join("covers");
        let db = save.join("index.sqlite");
        scan(&library, &db, &covers, |_| {}).unwrap();
        scan(&library, &db, &covers, |_| {}).unwrap();

        assert_eq!(books(&library), before, "the scan touched the user's own files");
        assert!(library.join(".library").exists(), "expected the save folder to be created");
        let _ = fs::remove_dir_all(&library);
    }
}

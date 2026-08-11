use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::Error;

type Result<T> = std::result::Result<T, Error>;

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

    fn parse(text: &str) -> Option<Self> {
        match text {
            "pdf" => Some(Self::Pdf),
            "epub" => Some(Self::Epub),
            _ => None,
        }
    }
}

/// A book as the front end sees it. `cover` is a cache-relative file name, not
/// a URL -- turning it into something loadable is the driver's job.
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
    pub indexed_at: i64,
}

pub fn open(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    migrate(&conn)?;
    Ok(conn)
}

/// Schema version lives in `user_version`; each step is applied in order so an
/// existing database upgrades rather than being rebuilt.
fn migrate(conn: &Connection) -> Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;

    let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if version < 1 {
        conn.execute_batch(
            "CREATE TABLE books (
                 id          TEXT PRIMARY KEY,
                 path        TEXT NOT NULL UNIQUE,
                 format      TEXT NOT NULL,
                 title       TEXT NOT NULL,
                 author      TEXT,
                 cover       TEXT,
                 page_count  INTEGER,
                 size_bytes  INTEGER NOT NULL,
                 mtime       INTEGER NOT NULL,
                 indexed_at  INTEGER NOT NULL
             );
             CREATE INDEX books_title ON books (title);
             CREATE INDEX books_author ON books (author);

             CREATE TABLE reading_progress (
                 book_id    TEXT PRIMARY KEY REFERENCES books (id) ON DELETE CASCADE,
                 page       INTEGER,
                 cfi        TEXT,
                 updated_at INTEGER NOT NULL
             );",
        )?;
        conn.pragma_update(None, "user_version", 1)?;
    }

    Ok(())
}

fn row_to_book(row: &rusqlite::Row<'_>) -> rusqlite::Result<Book> {
    let format: String = row.get("format")?;
    Ok(Book {
        id: row.get("id")?,
        path: row.get("path")?,
        // A row written by a newer version could carry a format this build does
        // not know; fall back rather than failing the whole listing.
        format: Format::parse(&format).unwrap_or(Format::Pdf),
        title: row.get("title")?,
        author: row.get("author")?,
        cover: row.get("cover")?,
        page_count: row.get::<_, Option<i64>>("page_count")?.map(|n| n as u32),
        size_bytes: row.get::<_, i64>("size_bytes")? as u64,
        indexed_at: row.get("indexed_at")?,
    })
}

pub fn upsert_book(conn: &Connection, book: &Book, mtime: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO books (id, path, format, title, author, cover, page_count, size_bytes, mtime, indexed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT (id) DO UPDATE SET
             path = excluded.path,
             format = excluded.format,
             title = excluded.title,
             author = excluded.author,
             cover = COALESCE(excluded.cover, books.cover),
             page_count = excluded.page_count,
             size_bytes = excluded.size_bytes,
             mtime = excluded.mtime,
             indexed_at = excluded.indexed_at",
        params![
            book.id,
            book.path,
            book.format.as_str(),
            book.title,
            book.author,
            book.cover,
            book.page_count.map(|n| n as i64),
            book.size_bytes as i64,
            mtime,
            book.indexed_at,
        ],
    )?;
    Ok(())
}

/// True when the file on disk is unchanged since the last index, so the
/// expensive probe can be skipped.
pub fn is_current(conn: &Connection, id: &str, size: u64, mtime: i64) -> Result<bool> {
    let found: Option<(i64, i64)> = conn
        .query_row(
            "SELECT size_bytes, mtime FROM books WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    Ok(found == Some((size as i64, mtime)))
}

pub fn list_books(conn: &Connection) -> Result<Vec<Book>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, format, title, author, cover, page_count, size_bytes, indexed_at
         FROM books ORDER BY author IS NULL, author, title",
    )?;
    let books = stmt
        .query_map([], row_to_book)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(books)
}

/// Drop rows whose file is no longer on disk. Returns the removed ids so their
/// cover files can be cleaned up too.
pub fn prune_missing(conn: &Connection, seen: &[String]) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM books")?;
    let all = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let seen: std::collections::HashSet<&str> = seen.iter().map(String::as_str).collect();
    let gone: Vec<String> = all.into_iter().filter(|id| !seen.contains(id.as_str())).collect();

    for id in &gone {
        conn.execute("DELETE FROM books WHERE id = ?1", params![id])?;
    }
    Ok(gone)
}

pub fn set_cover(conn: &Connection, id: &str, cover: &str) -> Result<()> {
    conn.execute("UPDATE books SET cover = ?2 WHERE id = ?1", params![id, cover])?;
    Ok(())
}

pub fn path_of(conn: &Connection, id: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT path FROM books WHERE id = ?1", params![id], |row| row.get(0))
        .optional()?)
}

pub fn count_books(conn: &Connection) -> Result<u32> {
    Ok(conn.query_row("SELECT COUNT(*) FROM books", [], |row| row.get::<_, i64>(0))? as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, title: &str) -> Book {
        Book {
            id: id.to_string(),
            path: format!(r"C:\books\{title}.epub"),
            format: Format::Epub,
            title: title.to_string(),
            author: Some("A. Writer".into()),
            cover: Some(format!("{id}.jpg")),
            page_count: Some(120),
            size_bytes: 4096,
            indexed_at: 1_700_000_000,
        }
    }

    #[test]
    fn migrate_is_idempotent() {
        let conn = open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 1);
    }

    #[test]
    fn upsert_replaces_rather_than_duplicating() {
        let conn = open_in_memory().unwrap();
        upsert_book(&conn, &sample("a", "First"), 10).unwrap();

        let mut renamed = sample("a", "First, Revised");
        renamed.path = r"C:\books\moved.epub".into();
        upsert_book(&conn, &renamed, 20).unwrap();

        let books = list_books(&conn).unwrap();
        assert_eq!(books.len(), 1);
        assert_eq!(books[0].title, "First, Revised");
        assert_eq!(books[0].path, r"C:\books\moved.epub");
    }

    #[test]
    fn upsert_keeps_an_existing_cover_when_the_new_probe_found_none() {
        let conn = open_in_memory().unwrap();
        upsert_book(&conn, &sample("a", "First"), 10).unwrap();

        let mut without = sample("a", "First");
        without.cover = None;
        upsert_book(&conn, &without, 20).unwrap();

        assert_eq!(list_books(&conn).unwrap()[0].cover.as_deref(), Some("a.jpg"));
    }

    #[test]
    fn is_current_tracks_size_and_mtime() {
        let conn = open_in_memory().unwrap();
        upsert_book(&conn, &sample("a", "First"), 10).unwrap();

        assert!(is_current(&conn, "a", 4096, 10).unwrap());
        assert!(!is_current(&conn, "a", 4096, 11).unwrap());
        assert!(!is_current(&conn, "a", 999, 10).unwrap());
        assert!(!is_current(&conn, "missing", 4096, 10).unwrap());
    }

    #[test]
    fn prune_removes_only_unseen_rows() {
        let conn = open_in_memory().unwrap();
        upsert_book(&conn, &sample("a", "Kept"), 10).unwrap();
        upsert_book(&conn, &sample("b", "Gone"), 10).unwrap();

        let removed = prune_missing(&conn, &["a".to_string()]).unwrap();
        assert_eq!(removed, vec!["b".to_string()]);
        assert_eq!(count_books(&conn).unwrap(), 1);
    }

    #[test]
    fn listing_sorts_unattributed_books_last() {
        let conn = open_in_memory().unwrap();
        let mut anon = sample("a", "Anonymous");
        anon.author = None;
        upsert_book(&conn, &anon, 10).unwrap();
        upsert_book(&conn, &sample("b", "Attributed"), 10).unwrap();

        let titles: Vec<_> = list_books(&conn).unwrap().into_iter().map(|b| b.title).collect();
        assert_eq!(titles, vec!["Attributed", "Anonymous"]);
    }
}

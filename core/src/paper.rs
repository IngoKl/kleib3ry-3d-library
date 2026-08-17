//! Fetching a paper off arXiv and putting it in the library.
//!
//! The only place that reaches the internet, and here rather than in the front
//! end because arxiv.org refuses cross-origin requests and the result is a file
//! in the library folder. What arrives is an ordinary book in `books/arxiv/` —
//! there is no arXiv-shaped row anywhere, so deleting this migrates nothing.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::catalog::{Book, Catalog, Format, relative_path};
use crate::{Error, Result, index};

/// Who we say we are. arXiv asks politely for something identifiable and
/// answers a bare default agent with a 403.
const USER_AGENT: &str = concat!("kleib3ry/", env!("CARGO_PKG_VERSION"), " (personal library)");

/// A paper is a paper, not a data set. Past this, something is wrong with the
/// id rather than with the paper.
const MAX_PDF_BYTES: u64 = 96 * 1024 * 1024;

const TIMEOUT: Duration = Duration::from_secs(45);

/// Where papers land: under `books/` so the scanner finds them, in a folder of
/// their own so an arranged library can tell what it did not choose.
pub const PAPERS_DIR: &str = "arxiv";

/// What arXiv says about a paper, which is more than its PDF does.
#[derive(Debug, Clone, Default)]
pub struct Metadata {
    pub title: Option<String>,
    pub authors: Vec<String>,
}

/// Turn whatever somebody typed into an arXiv id: a bare id, an `arXiv:` prefix,
/// or the URL of the abstract or the PDF. Anything else is refused here, with
/// the text they typed, rather than as a 404 from arXiv.
pub fn parse_id(input: &str) -> Option<String> {
    let mut text = input.trim();
    if text.is_empty() {
        return None;
    }

    // A URL: take the part after /abs/ or /pdf/, which is the id in both.
    if let Some(rest) = text.rfind("/abs/").map(|at| &text[at + 5..]) {
        text = rest;
    } else if let Some(rest) = text.rfind("/pdf/").map(|at| &text[at + 5..]) {
        text = rest;
    }

    let text = text.trim();
    let text = text.strip_prefix("arXiv:").or_else(|| text.strip_prefix("arxiv:")).unwrap_or(text);
    let text = text.strip_suffix(".pdf").unwrap_or(text);
    let text = text.trim_end_matches('/').trim();

    if !looks_like_id(text) {
        return None;
    }
    Some(text.to_string())
}

/// The two shapes an arXiv id comes in: `2401.12345v2` since 2007, and
/// `math.GT/0211159` before it.
fn looks_like_id(text: &str) -> bool {
    let body = text.split('v').next().unwrap_or(text);
    let modern = |body: &str| {
        let Some((head, tail)) = body.split_once('.') else { return false };
        head.len() == 4
            && (4..=5).contains(&tail.len())
            && head.chars().all(|c| c.is_ascii_digit())
            && tail.chars().all(|c| c.is_ascii_digit())
    };
    let legacy = |body: &str| {
        let Some((archive, number)) = body.split_once('/') else { return false };
        !archive.is_empty()
            && archive.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
            && number.len() == 7
            && number.chars().all(|c| c.is_ascii_digit())
    };
    // A legacy id has a slash in it, which `split('v')` would cut through in
    // `math.GT/0211159` — so it is tested against the whole string.
    modern(body) || legacy(text.split_once('v').map(|(head, _)| head).unwrap_or(text))
}

fn network(e: impl std::fmt::Display) -> Error {
    Error::Network(e.to_string())
}

/// Ask arXiv what the paper is called. A failure here is not fatal: the paper
/// is still worth having, and the PDF's own metadata is the fallback.
pub fn metadata(id: &str) -> Metadata {
    let url = format!("https://export.arxiv.org/api/query?id_list={id}&max_results=1");
    let Ok(atom) = get_text(&url) else { return Metadata::default() };
    parse_atom(&atom)
}

fn get_text(url: &str) -> Result<String> {
    let mut response = ureq::get(url)
        .header("User-Agent", USER_AGENT)
        .config()
        .timeout_global(Some(TIMEOUT))
        .build()
        .call()
        .map_err(network)?;
    response.body_mut().read_to_string().map_err(network)
}

/// Title and authors out of the arXiv Atom feed, by hand with `quick-xml` —
/// already here for the EPUB probe, and two fields do not earn a deserialiser
/// tied to a schema nobody here controls.
fn parse_atom(atom: &str) -> Metadata {
    use quick_xml::events::Event;

    let mut reader = quick_xml::Reader::from_str(atom);
    let mut out = Metadata::default();
    let mut buffer = Vec::new();
    // The feed itself has a title too, so nothing counts until the entry opens.
    let mut in_entry = false;
    let mut in_author = false;
    let mut want: Option<&str> = None;

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(tag)) => match tag.local_name().as_ref() {
                b"entry" => in_entry = true,
                b"author" if in_entry => in_author = true,
                b"title" if in_entry && out.title.is_none() => want = Some("title"),
                b"name" if in_author => want = Some("name"),
                _ => {}
            },
            Ok(Event::End(tag)) => match tag.local_name().as_ref() {
                b"entry" => in_entry = false,
                b"author" => in_author = false,
                _ => want = None,
            },
            Ok(Event::Text(text)) => {
                if let Some(field) = want.take() {
                    let value = text.decode().map(|t| tidy(&t)).unwrap_or_default();
                    if value.is_empty() {
                        continue;
                    }
                    match field {
                        "title" => out.title = Some(value),
                        _ => out.authors.push(value),
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buffer.clear();
    }
    out
}

/// arXiv wraps titles and abstracts at whatever width the submission had.
fn tidy(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A file name that every filesystem will take, and a person can read.
fn file_name(id: &str, title: Option<&str>) -> String {
    let safe = |text: &str| {
        text.chars()
            .map(|c| if c.is_ascii_alphanumeric() || " -_.,()".contains(c) { c } else { ' ' })
            .collect::<String>()
    };
    let stem = safe(&id.replace('/', "-"));
    match title {
        // Title first — it is what a spine has room for; the id keeps two
        // papers of the same name distinct.
        Some(title) if !title.is_empty() => {
            let title = tidy(&safe(title));
            let title: String = title.chars().take(110).collect();
            format!("{} ({stem}).pdf", title.trim())
        }
        _ => format!("{stem}.pdf"),
    }
}

/// Download the paper, put it in the library folder, and index it. Returns the
/// book exactly as a scan would have, so the front end special-cases nothing.
pub fn fetch(root: &Path, index_path: &Path, covers_dir: &Path, input: &str) -> Result<Book> {
    let id = parse_id(input).ok_or_else(|| Error::BadPaperId(input.trim().to_string()))?;

    let facts = metadata(&id);
    let bytes = download(&id)?;

    let folder = papers_dir(root);
    std::fs::create_dir_all(&folder)?;
    let path = folder.join(file_name(&id, facts.title.as_deref()));
    std::fs::write(&path, &bytes)?;

    let mut book = index::index_one(&path, Format::Pdf, covers_dir)?;
    // arXiv beats the PDF, whose metadata is whatever LaTeX left in it.
    if let Some(title) = facts.title {
        book.title = title;
    }
    if !facts.authors.is_empty() {
        book.author = Some(join_authors(&facts.authors));
    }

    // Indexed now rather than at the next scan: the courier is already walking,
    // and the book has to exist by the time it is put down.
    let mut catalog = Catalog::load(index_path)?;
    let rel = relative_path(root, &path);
    catalog.upsert(&book, &rel, index::modified_millis(&std::fs::metadata(&path)?));
    catalog.save(index_path)?;

    Ok(book)
}

/// Where papers go in this library folder.
pub fn papers_dir(root: &Path) -> PathBuf {
    index::books_root(root).unwrap_or_else(|| root.to_path_buf()).join(PAPERS_DIR)
}

/// "A, B and C" up to three, then "A and others" — a spine is not a citation.
fn join_authors(authors: &[String]) -> String {
    match authors {
        [] => String::new(),
        [one] => one.clone(),
        [one, two] => format!("{one} and {two}"),
        [one, two, three] => format!("{one}, {two} and {three}"),
        [one, ..] => format!("{one} and others"),
    }
}

fn download(id: &str) -> Result<Vec<u8>> {
    let url = format!("https://arxiv.org/pdf/{id}");
    let mut response = ureq::get(&url)
        .header("User-Agent", USER_AGENT)
        .config()
        .timeout_global(Some(TIMEOUT))
        .build()
        .call()
        .map_err(|e| match e {
            ureq::Error::StatusCode(404) => Error::UnknownPaper(id.to_string()),
            other => network(other),
        })?;

    let bytes = response
        .body_mut()
        .with_config()
        .limit(MAX_PDF_BYTES)
        .read_to_vec()
        .map_err(network)?;

    // arXiv answers a withdrawn paper with an HTML page and a 200; saving that
    // as a `.pdf` would put an unreadable book on the shelf.
    if !bytes.starts_with(b"%PDF") {
        return Err(Error::UnknownPaper(id.to_string()));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_read_out_of_whatever_was_pasted() {
        for input in [
            "2401.12345",
            " arXiv:2401.12345 ",
            "https://arxiv.org/abs/2401.12345",
            "http://arxiv.org/pdf/2401.12345.pdf",
        ] {
            assert_eq!(parse_id(input).as_deref(), Some("2401.12345"), "{input}");
        }
        // A version is part of the id: it names a particular revision.
        assert_eq!(parse_id("arXiv:2401.12345v3").as_deref(), Some("2401.12345v3"));
        // And the pre-2007 shape, slash and all.
        assert_eq!(parse_id("math.GT/0211159").as_deref(), Some("math.GT/0211159"));
        assert_eq!(parse_id("https://arxiv.org/abs/hep-th/9711200").as_deref(), Some("hep-th/9711200"));
    }

    #[test]
    fn anything_else_is_refused_here_rather_than_by_arxiv() {
        for input in ["", "   ", "the one about attention", "1234", "2401.1234567", "not/anid"] {
            assert!(parse_id(input).is_none(), "{input:?} was accepted");
        }
    }

    #[test]
    fn the_atom_feed_gives_up_its_title_and_authors() {
        let atom = r#"<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <title type="html">ArXiv Query: search_query=</title>
          <entry>
            <title>Attention Is All
              You Need</title>
            <author><name>Ashish Vaswani</name></author>
            <author><name>Noam Shazeer</name></author>
          </entry>
        </feed>"#;
        let facts = parse_atom(atom);
        // The feed's own title is not the paper's, and the wrapping is undone.
        assert_eq!(facts.title.as_deref(), Some("Attention Is All You Need"));
        assert_eq!(facts.authors, vec!["Ashish Vaswani", "Noam Shazeer"]);
    }

    #[test]
    fn a_file_name_carries_the_title_and_stays_a_file_name() {
        let name = file_name("hep-th/9711200", Some("The Large N Limit: a/b\\c"));
        assert!(!name.contains('/'), "{name}");
        assert!(!name.contains('\\'), "{name}");
        assert!(name.ends_with(".pdf"));
        assert!(name.contains("hep-th-9711200"));
        // No title is still a file, named for the paper.
        assert_eq!(file_name("2401.12345", None), "2401.12345.pdf");
    }

    /// Ignored so the rest of the suite stays offline. Run this module's changes
    /// through `cargo test -p kleib3ry_core -- --ignored`.
    #[test]
    #[ignore = "reaches arxiv.org"]
    fn a_real_paper_comes_down_and_is_indexed() {
        let dir = std::env::temp_dir().join("kleib3ry-paper-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("books")).unwrap();
        let index = dir.join("index.json");
        let covers = dir.join("covers");

        let book = fetch(&dir, &index, &covers, "arXiv:1706.03762").expect("fetch");
        assert_eq!(book.title, "Attention Is All You Need");
        assert!(book.author.as_deref().unwrap_or("").contains("Vaswani"), "{book:?}");
        assert!(book.size_bytes > 100_000, "{} bytes", book.size_bytes);
        assert!(book.path.contains("arxiv"), "{}", book.path);
        assert!(std::fs::read(&book.path).unwrap().starts_with(b"%PDF"));
        // And it is in the index, so the front end sees it without a rescan.
        assert!(Catalog::load(&index).unwrap().contains(&book.id));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn authors_are_credited_up_to_three() {
        let names = |n: usize| -> Vec<String> {
            ["A", "B", "C", "D"].iter().take(n).map(|s| s.to_string()).collect()
        };
        assert_eq!(join_authors(&names(1)), "A");
        assert_eq!(join_authors(&names(2)), "A and B");
        assert_eq!(join_authors(&names(3)), "A, B and C");
        assert_eq!(join_authors(&names(4)), "A and others");
    }
}

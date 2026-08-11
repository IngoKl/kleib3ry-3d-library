pub mod audio;
pub mod epub;
pub mod pdf;

use std::path::Path;

/// A cover image exactly as it was stored inside the book, so it can be written
/// to the cache without a re-encode.
#[derive(Debug, Clone, PartialEq)]
pub struct CoverImage {
    pub bytes: Vec<u8>,
    pub ext: &'static str,
}

/// Everything a format probe managed to learn. Every field is optional: a probe
/// that fails partially still contributes what it found, and the indexer fills
/// the gaps from the filename.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Probed {
    pub title: Option<String>,
    pub author: Option<String>,
    pub page_count: Option<u32>,
    pub cover: Option<CoverImage>,
}

pub fn extension_for(mime_or_href: &str) -> &'static str {
    let lower = mime_or_href.to_ascii_lowercase();
    if lower.ends_with(".png") || lower.contains("png") {
        "png"
    } else if lower.ends_with(".gif") || lower.contains("gif") {
        "gif"
    } else if lower.ends_with(".webp") || lower.contains("webp") {
        "webp"
    } else if lower.ends_with(".svg") || lower.contains("svg") {
        "svg"
    } else {
        "jpg"
    }
}

/// Last-resort title: the file name, tidied up. Real libraries are full of
/// `the_hobbit_(1937)_retail.epub`, and that reads better as "The Hobbit 1937
/// Retail" than as the raw stem.
pub fn title_from_filename(path: &Path) -> String {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".to_string());

    let cleaned: String = stem
        .chars()
        .map(|c| match c {
            '_' | '.' | '-' | '(' | ')' | '[' | ']' => ' ',
            other => other,
        })
        .collect();

    let words: Vec<String> = cleaned
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                // Leave words that already carry capitals alone, so "PDF" and
                // "McCarthy" survive.
                Some(first) if word.chars().any(char::is_uppercase) => {
                    first.to_string() + chars.as_str()
                }
                Some(first) => first.to_uppercase().to_string() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect();

    if words.is_empty() {
        "Untitled".to_string()
    } else {
        words.join(" ")
    }
}

/// Trim and discard values that carry no information.
pub fn meaningful(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("untitled") {
        return None;
    }
    Some(trimmed.to_string())
}

/// Extensions that betray a title carried over from the file the PDF was
/// exported from, rather than the name of the book.
const PRODUCTION_SUFFIXES: [&str; 9] = [
    ".indd", ".qxd", ".qxp", ".doc", ".docx", ".pdf", ".tex", ".fm", ".pages",
];

/**
Whether an embedded title is worth preferring over the filename.

Real libraries are full of PDFs whose `/Title` is `310904_1_De_Print.indd` or
`Microsoft Word - final_v3.doc` — the export artefact, not the book. When the
metadata looks like that, the filename is almost always better.
*/
pub fn plausible_title(value: &str) -> Option<String> {
    let text = meaningful(value)?;
    let lower = text.to_lowercase();

    if text.chars().count() < 3 {
        return None;
    }
    if PRODUCTION_SUFFIXES.iter().any(|suffix| lower.ends_with(suffix)) {
        return None;
    }
    if lower.starts_with("microsoft word -") || lower.starts_with("untitled") {
        return None;
    }
    // A bare document id. Short all-digit titles are left alone, because "1984"
    // and "2666" are books.
    let letters = text.chars().filter(|c| c.is_alphabetic()).count();
    if letters == 0 && text.chars().count() >= 6 {
        return None;
    }
    // Identifier-shaped: no spaces, underscore-separated, with numbers in it.
    if !text.contains(' ') && text.contains('_') && text.chars().any(char::is_numeric) {
        return None;
    }
    Some(text)
}

/// Software that writes its own name into `/Author`, seen across a real
/// collection. These are producers, not people.
const AUTHORING_TOOLS: [&str; 12] = [
    "adobe", "indesign", "acrobat", "distiller", "framemaker", "quark", "pagemaker",
    "microsoft word", "openoffice", "libreoffice", "ghostscript", "pdflatex",
];

/// Authors get the same treatment: `0000253` is a document id, not a person,
/// and `Adobe InDesign CS6 (Windows)` is the tool that made the file.
pub fn plausible_author(value: &str) -> Option<String> {
    let text = meaningful(value)?;
    let lower = text.to_lowercase();

    if AUTHORING_TOOLS.iter().any(|tool| lower.contains(tool)) {
        return None;
    }
    let letters = text.chars().filter(|c| c.is_alphabetic()).count();
    if letters < 2 || text.chars().filter(|c| c.is_numeric()).count() > letters {
        return None;
    }
    Some(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn filename_titles_are_tidied() {
        let cases = [
            ("the_hobbit_(1937)_retail.epub", "The Hobbit 1937 Retail"),
            ("gravitys-rainbow.pdf", "Gravitys Rainbow"),
            ("McCarthy - Blood Meridian.epub", "McCarthy Blood Meridian"),
            ("SICP.pdf", "SICP"),
        ];
        for (file, expected) in cases {
            assert_eq!(title_from_filename(&PathBuf::from(file)), expected, "for {file}");
        }
    }

    #[test]
    fn a_nameless_path_still_yields_a_title() {
        assert_eq!(title_from_filename(&PathBuf::from("")), "Untitled");
    }

    #[test]
    fn blank_metadata_is_discarded() {
        assert_eq!(meaningful("  "), None);
        assert_eq!(meaningful("Untitled"), None);
        assert_eq!(meaningful("  Dune "), Some("Dune".to_string()));
    }

    #[test]
    fn export_artefacts_are_rejected_as_titles() {
        // Seen in a real 278-book library.
        assert_eq!(plausible_title("310904_1_De_Print.indd"), None);
        assert_eq!(plausible_title("Microsoft Word - final_v3.doc"), None);
        assert_eq!(plausible_title("thesis.pdf"), None);
        assert_eq!(plausible_title("12345678"), None);
        assert_eq!(plausible_title("310904_1_De_Print"), None);
        assert_eq!(plausible_title("ab"), None);
        assert_eq!(plausible_title("  "), None);
    }

    #[test]
    fn real_titles_survive() {
        for good in [
            "Gravity's Rainbow",
            "1984", // an all-digit title is still a title
            "2666",
            "Slaughterhouse-Five",
            "The C Programming Language, 2nd Edition",
            "Effective_Java", // underscores alone are not suspicious
        ] {
            assert_eq!(plausible_title(good).as_deref(), Some(good), "rejected {good}");
        }
    }

    #[test]
    fn document_ids_are_rejected_as_authors() {
        assert_eq!(plausible_author("0000253"), None);
        assert_eq!(plausible_author("A"), None);
        // The tool that exported the file, also seen in a real library.
        assert_eq!(plausible_author("Adobe InDesign CS6 (Windows)"), None);
        assert_eq!(plausible_author("Microsoft Word"), None);
        assert_eq!(plausible_author("Ursula K. Le Guin").as_deref(), Some("Ursula K. Le Guin"));
        assert_eq!(plausible_author("W. Adobe").as_deref(), None); // rare false positive, accepted
    }

    #[test]
    fn cover_extensions_follow_the_href_or_mime() {
        assert_eq!(extension_for("cover.png"), "png");
        assert_eq!(extension_for("image/png"), "png");
        assert_eq!(extension_for("cover.jpeg"), "jpg");
        assert_eq!(extension_for("image/webp"), "webp");
    }
}

use std::path::Path;

use super::{plausible_author, plausible_title, Probed};

/// Page count and Info-dictionary metadata. Cover rasterisation is deliberately
/// not here: it needs a real renderer (pdfium), which is a separate decision
/// about shipping a native library.
pub fn probe(path: &Path) -> Probed {
    let Ok(doc) = lopdf::Document::load(path) else {
        return Probed::default();
    };

    let page_count = u32::try_from(doc.get_pages().len()).ok();
    let (title, author) = info_strings(&doc);

    Probed { title, author, page_count, cover: None }
}

fn info_strings(doc: &lopdf::Document) -> (Option<String>, Option<String>) {
    let Ok(info) = doc.trailer.get(b"Info") else {
        return (None, None);
    };
    // /Info is usually an indirect reference, occasionally inline.
    let dict = match info {
        lopdf::Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| o.as_dict().ok()),
        lopdf::Object::Dictionary(d) => Some(d),
        _ => None,
    };
    let Some(dict) = dict else { return (None, None) };

    let read = |key: &[u8]| {
        dict.get(key).ok().and_then(|o| o.as_str().ok()).map(decode_pdf_text)
    };
    (
        read(b"Title").and_then(|s| plausible_title(&s)),
        read(b"Author").and_then(|s| plausible_author(&s)),
    )
}

/// PDF text strings are either UTF-16BE with a byte-order mark, or
/// PDFDocEncoding, which agrees with Latin-1 across the range that matters here.
fn decode_pdf_text(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        bytes.iter().map(|&b| b as char).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf16_with_a_byte_order_mark() {
        let mut bytes = vec![0xFE, 0xFF];
        for unit in "Café".encode_utf16() {
            bytes.extend_from_slice(&unit.to_be_bytes());
        }
        assert_eq!(decode_pdf_text(&bytes), "Café");
    }

    #[test]
    fn decodes_latin1_without_a_mark() {
        assert_eq!(decode_pdf_text(b"Plain Title"), "Plain Title");
        assert_eq!(decode_pdf_text(&[0x43, 0x61, 0x66, 0xE9]), "Café");
    }

    #[test]
    fn a_missing_file_probes_to_nothing() {
        assert_eq!(probe(Path::new("no-such-file.pdf")), Probed::default());
    }

    #[test]
    fn a_non_pdf_probes_to_nothing() {
        let path = std::env::temp_dir().join("kleib3ry-not-a.pdf");
        std::fs::write(&path, b"definitely not a pdf").unwrap();
        assert_eq!(probe(&path), Probed::default());
        std::fs::remove_file(&path).ok();
    }
}

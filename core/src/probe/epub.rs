use std::io::Read;

use quick_xml::events::Event;
use quick_xml::Reader;

use super::{extension_for, meaningful, CoverImage, Probed};

/// Parse an EPUB far enough to get title, author and cover art. An EPUB is a
/// zip whose `META-INF/container.xml` points at a package document (`.opf`)
/// carrying the metadata and a manifest.
pub fn probe(bytes: &[u8]) -> Probed {
    let cursor = std::io::Cursor::new(bytes);
    let Ok(mut zip) = zip::ZipArchive::new(cursor) else {
        return Probed::default();
    };

    let Some(opf_path) = read_entry(&mut zip, "META-INF/container.xml")
        .and_then(|xml| rootfile_path(&xml))
    else {
        return Probed::default();
    };

    let Some(opf) = read_entry(&mut zip, &opf_path) else {
        return Probed::default();
    };

    let package = parse_package(&opf);
    let base = opf_path.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("");

    let cover = package.cover_href.as_ref().and_then(|href| {
        let full = join(base, href);
        let bytes = read_entry_bytes(&mut zip, &full)?;
        Some(CoverImage { bytes, ext: extension_for(&full) })
    });

    Probed {
        title: package.title,
        author: package.author,
        page_count: estimated_pages(&mut zip),
        cover,
    }
}

/// `epubPages.ts` fits about 950 characters on a page, and the markup around
/// them adds a quarter again.
const BYTES_PER_PAGE: u64 = 1_200;

/// About how long this book is, in the reader's own pages. A reflowable book has
/// no pages until something lays it out, but the shelf needs a thickness — and
/// compressed file size is mostly cover art, which shelves a picture book as a
/// doorstop. The zip's central directory carries uncompressed sizes, so this
/// sums the documents and divides without decompressing anything.
fn estimated_pages<R: Read + std::io::Seek>(zip: &mut zip::ZipArchive<R>) -> Option<u32> {
    let mut bytes: u64 = 0;
    for i in 0..zip.len() {
        let Ok(entry) = zip.by_index_raw(i) else { continue };
        let name = entry.name().to_ascii_lowercase();
        if name.ends_with(".xhtml") || name.ends_with(".html") || name.ends_with(".htm") {
            bytes = bytes.saturating_add(entry.size());
        }
    }
    // Unmeasurable, not zero-length — `None` lets the front end use file size.
    (bytes > 0).then(|| u32::try_from(bytes / BYTES_PER_PAGE).unwrap_or(u32::MAX).max(1))
}

fn read_entry<R: Read + std::io::Seek>(zip: &mut zip::ZipArchive<R>, name: &str) -> Option<String> {
    let bytes = read_entry_bytes(zip, name)?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// No cover is this big. An entry claiming otherwise is a bomb, and decompressing
/// it unbounded aborts on allocation, which no `catch_unwind` can contain.
const MAX_ENTRY_BYTES: u64 = 32 * 1024 * 1024;

fn read_entry_bytes<R: Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
) -> Option<Vec<u8>> {
    // Zip paths are case-sensitive in the spec but not in the wild.
    let index = (0..zip.len()).find(|&i| {
        zip.by_index_raw(i)
            .map(|f| f.name().eq_ignore_ascii_case(name))
            .unwrap_or(false)
    })?;
    let file = zip.by_index(index).ok()?;
    let mut buf = Vec::new();
    file.take(MAX_ENTRY_BYTES + 1).read_to_end(&mut buf).ok()?;
    (buf.len() as u64 <= MAX_ENTRY_BYTES).then_some(buf)
}

/// Resolve a manifest href against the package document's directory. Hrefs are
/// relative URLs, and the zip directory stores neither dot segments nor percent
/// escapes, so `../cover.jpg` and `image%20one.png` never match literally.
fn join(base: &str, href: &str) -> String {
    let href = percent_decode(href);
    let mut parts: Vec<&str> =
        if base.is_empty() { Vec::new() } else { base.split('/').collect() };
    for segment in href.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let decoded = (bytes[i] == b'%' && i + 2 < bytes.len())
            .then(|| {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
                u8::from_str_radix(hex, 16).ok()
            })
            .flatten();
        match decoded {
            Some(b) => {
                out.push(b);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn rootfile_path(xml: &str) -> Option<String> {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(e)) | Ok(Event::Start(e)) if e.local_name().as_ref() == b"rootfile" => {
                if let Some(path) = attribute(&e, b"full-path") {
                    return Some(path);
                }
            }
            Ok(Event::Eof) | Err(_) => return None,
            _ => {}
        }
        buf.clear();
    }
}

#[derive(Debug, Default, PartialEq)]
struct Package {
    title: Option<String>,
    author: Option<String>,
    cover_href: Option<String>,
}

/// Two ways to declare a cover: EPUB 3 marks the manifest item with
/// `properties="cover-image"`; EPUB 2 uses `<meta name="cover" content="id"/>`
/// pointing at a manifest id. Real files use either, so collect both.
fn parse_package(xml: &str) -> Package {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();

    let mut package = Package::default();
    let mut manifest: Vec<(String, String, Option<String>)> = Vec::new(); // id, href, properties
    let mut cover_id: Option<String> = None;
    let mut collecting: Option<&'static str> = None;
    let mut text = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => match e.local_name().as_ref() {
                b"title" if package.title.is_none() => {
                    collecting = Some("title");
                    text.clear();
                }
                b"creator" if package.author.is_none() => {
                    collecting = Some("creator");
                    text.clear();
                }
                _ => {}
            },
            Ok(Event::Text(e)) if collecting.is_some() => {
                text.push_str(&e.decode().unwrap_or_default());
            }
            Ok(Event::End(e)) => {
                match (collecting, e.local_name().as_ref()) {
                    (Some("title"), b"title") => package.title = meaningful(&text),
                    (Some("creator"), b"creator") => package.author = meaningful(&text),
                    _ => {}
                }
                if matches!(e.local_name().as_ref(), b"title" | b"creator") {
                    collecting = None;
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    // Second pass for the attribute-shaped data, so the text handling above
    // need not also cope with empty elements.
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(e)) | Ok(Event::Start(e)) => match e.local_name().as_ref() {
                b"item" => {
                    let id = attribute(&e, b"id");
                    let href = attribute(&e, b"href");
                    if let (Some(id), Some(href)) = (id, href) {
                        manifest.push((id, href, attribute(&e, b"properties")));
                    }
                }
                b"meta" => {
                    if attribute(&e, b"name").as_deref() == Some("cover") {
                        cover_id = attribute(&e, b"content");
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    package.cover_href = manifest
        .iter()
        .find(|(_, _, props)| {
            props
                .as_deref()
                .is_some_and(|p| p.split_whitespace().any(|t| t == "cover-image"))
        })
        .or_else(|| {
            cover_id
                .as_ref()
                .and_then(|want| manifest.iter().find(|(id, _, _)| id == want))
        })
        // Last resort: a manifest entry that simply looks like a cover.
        .or_else(|| {
            manifest
                .iter()
                .find(|(id, href, _)| {
                    let h = href.to_ascii_lowercase();
                    id.to_ascii_lowercase().contains("cover")
                        && (h.ends_with(".jpg")
                            || h.ends_with(".jpeg")
                            || h.ends_with(".png")
                            || h.ends_with(".webp"))
                })
        })
        .map(|(_, href, _)| href.clone());

    package
}

fn attribute(e: &quick_xml::events::BytesStart<'_>, name: &[u8]) -> Option<String> {
    e.attributes().flatten().find(|a| a.key.as_ref() == name).and_then(|a| {
        String::from_utf8(a.value.into_owned()).ok().and_then(|v| meaningful(&v))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONTAINER: &str = r#"<?xml version="1.0"?>
      <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/content.opf"
          media-type="application/oebps-package+xml"/></rootfiles>
      </container>"#;

    #[test]
    fn finds_the_package_document() {
        assert_eq!(rootfile_path(CONTAINER).as_deref(), Some("OEBPS/content.opf"));
    }

    #[test]
    fn reads_epub3_metadata_and_cover() {
        let opf = r#"<?xml version="1.0"?>
          <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
            <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
              <dc:title>Piranesi</dc:title>
              <dc:creator>Susanna Clarke</dc:creator>
            </metadata>
            <manifest>
              <item id="c" href="images/cover.png" properties="cover-image"
                    media-type="image/png"/>
              <item id="s1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
            </manifest>
          </package>"#;
        let parsed = parse_package(opf);
        assert_eq!(parsed.title.as_deref(), Some("Piranesi"));
        assert_eq!(parsed.author.as_deref(), Some("Susanna Clarke"));
        assert_eq!(parsed.cover_href.as_deref(), Some("images/cover.png"));
    }

    #[test]
    fn reads_the_epub2_cover_meta_pointer() {
        let opf = r#"<package>
            <metadata><dc:title>Old Book</dc:title>
              <meta name="cover" content="cover-img"/></metadata>
            <manifest>
              <item id="cover-img" href="cover.jpeg" media-type="image/jpeg"/>
            </manifest>
          </package>"#;
        let parsed = parse_package(opf);
        assert_eq!(parsed.title.as_deref(), Some("Old Book"));
        assert_eq!(parsed.cover_href.as_deref(), Some("cover.jpeg"));
    }

    #[test]
    fn falls_back_to_a_cover_shaped_manifest_entry() {
        let opf = r#"<package><metadata/><manifest>
              <item id="the-cover" href="img/cover.jpg" media-type="image/jpeg"/>
            </manifest></package>"#;
        assert_eq!(parse_package(opf).cover_href.as_deref(), Some("img/cover.jpg"));
    }

    #[test]
    fn a_package_with_nothing_useful_yields_nothing() {
        let parsed = parse_package("<package><metadata/><manifest/></package>");
        assert_eq!(parsed, Package::default());
    }

    #[test]
    fn hrefs_resolve_against_the_package_directory() {
        assert_eq!(join("OEBPS", "images/cover.png"), "OEBPS/images/cover.png");
        assert_eq!(join("", "cover.png"), "cover.png");
        // Relative-URL forms the zip directory does not store literally.
        assert_eq!(join("OEBPS", "../cover.jpg"), "cover.jpg");
        assert_eq!(join("OEBPS", "./images/cover.png"), "OEBPS/images/cover.png");
        assert_eq!(join("OEBPS", "image%20one.png"), "OEBPS/image one.png");
        assert_eq!(join("", "../../escape.png"), "escape.png");
    }

    #[test]
    fn a_file_that_is_not_a_zip_probes_to_nothing() {
        assert_eq!(probe(b"this is not an epub"), Probed::default());
    }

    /// A zip of named entries with the given uncompressed sizes, which is all
    /// `estimated_pages` reads — it never decompresses anything.
    fn zip_of(entries: &[(&str, usize)]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, size) in entries {
            writer.start_file::<_, ()>(*name, zip::write::SimpleFileOptions::default()).unwrap();
            std::io::Write::write_all(&mut writer, &vec![b'a'; *size]).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn length_comes_from_the_documents_rather_than_the_file_size() {
        // A novel: half a megabyte of text and nothing else.
        let novel = zip_of(&[("OEBPS/ch1.xhtml", 240_000), ("OEBPS/ch2.xhtml", 240_000)]);
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(novel)).unwrap();
        assert_eq!(estimated_pages(&mut zip), Some(400));

        // A picture book: the same file size, almost all of it artwork. The old
        // size-based guess called this the longer of the two.
        let pictures = zip_of(&[("OEBPS/text.html", 24_000), ("OEBPS/plate.jpg", 800_000)]);
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(pictures)).unwrap();
        assert_eq!(estimated_pages(&mut zip), Some(20));

        // Nothing measurable: not "no pages", but "ask somebody else".
        let empty = zip_of(&[("mimetype", 20), ("OEBPS/style.css", 4_000)]);
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(empty)).unwrap();
        assert_eq!(estimated_pages(&mut zip), None);
    }
}

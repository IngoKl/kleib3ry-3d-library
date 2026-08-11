use std::io::Read;

use quick_xml::events::Event;
use quick_xml::Reader;

use super::{extension_for, meaningful, CoverImage, Probed};

/// Parse an EPUB far enough to get title, author and cover art.
///
/// An EPUB is a zip: `META-INF/container.xml` points at a package document
/// (`.opf`) which carries the metadata and a manifest of every file inside.
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
        page_count: None, // reflowable: pages do not exist until it is laid out
        cover,
    }
}

fn read_entry<R: Read + std::io::Seek>(zip: &mut zip::ZipArchive<R>, name: &str) -> Option<String> {
    let bytes = read_entry_bytes(zip, name)?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

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
    let mut file = zip.by_index(index).ok()?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).ok()?;
    Some(buf)
}

fn join(base: &str, href: &str) -> String {
    if base.is_empty() {
        href.to_string()
    } else {
        format!("{base}/{href}")
    }
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

    // Second pass for the attribute-shaped data. `item` and `meta` appear as
    // either empty or start elements; a separate pass keeps the text handling
    // above from having to care.
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
    }

    #[test]
    fn a_file_that_is_not_a_zip_probes_to_nothing() {
        assert_eq!(probe(b"this is not an epub"), Probed::default());
    }
}

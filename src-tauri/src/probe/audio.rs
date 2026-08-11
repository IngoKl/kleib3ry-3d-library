//! Track metadata, read directly rather than through a tagging crate.
//!
//! Only two containers are worth the code: ID3v2 (which is what an MP3 has) and
//! a FLAC Vorbis comment. Both are a length-prefixed list of key/value pairs a
//! short way into the file, and reading them here keeps the dependency list —
//! and therefore the licence surface of anything shipped — exactly where it was.
//!
//! Everything else falls back to the filename, and to the folder above it for
//! the artist, because `music/Nina Simone/Wild Is the Wind/03 Four Women.mp3`
//! is how music folders are actually laid out.

use std::fs;
use std::path::Path;

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Tags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
}

impl Tags {
    fn is_empty(&self) -> bool {
        self.title.is_none() && self.artist.is_none() && self.album.is_none()
    }
}

/// How much of a file to read looking for tags. ID3v2 is at the very front and
/// a FLAC comment block is within the first few blocks; a megabyte is generous
/// for both and bounded for a folder of thousands of tracks.
const HEAD_BYTES: usize = 1024 * 1024;

pub fn read(path: &Path) -> Tags {
    let Ok(bytes) = read_head(path) else {
        return Tags::default();
    };

    let tags = if bytes.starts_with(b"ID3") {
        id3v2(&bytes)
    } else if bytes.starts_with(b"fLaC") {
        flac(&bytes)
    } else {
        Tags::default()
    };

    if tags.is_empty() {
        id3v1(path).unwrap_or_default()
    } else {
        tags
    }
}

fn read_head(path: &Path) -> std::io::Result<Vec<u8>> {
    use std::io::Read;
    let mut file = fs::File::open(path)?;
    let mut buffer = vec![0u8; HEAD_BYTES];
    let mut filled = 0;
    while filled < buffer.len() {
        match file.read(&mut buffer[filled..])? {
            0 => break,
            n => filled += n,
        }
    }
    buffer.truncate(filled);
    Ok(buffer)
}

/// A 28-bit integer stored seven bits to the byte, which is how ID3 avoids
/// producing anything that looks like an MPEG frame sync.
fn syncsafe(b: &[u8]) -> usize {
    ((b[0] as usize & 0x7f) << 21)
        | ((b[1] as usize & 0x7f) << 14)
        | ((b[2] as usize & 0x7f) << 7)
        | (b[3] as usize & 0x7f)
}

fn be32(b: &[u8]) -> usize {
    ((b[0] as usize) << 24) | ((b[1] as usize) << 16) | ((b[2] as usize) << 8) | b[3] as usize
}

fn le32(b: &[u8]) -> usize {
    (b[0] as usize) | ((b[1] as usize) << 8) | ((b[2] as usize) << 16) | ((b[3] as usize) << 24)
}

/// Decode an ID3 text frame body, whose first byte says how the rest is encoded.
fn text_frame(body: &[u8]) -> Option<String> {
    let (encoding, rest) = body.split_first()?;
    let decoded = match encoding {
        // Latin-1: every byte is its own code point.
        0 => rest.iter().map(|&b| b as char).collect::<String>(),
        1 => utf16_with_bom(rest)?,
        2 => utf16(rest, true),
        3 => String::from_utf8_lossy(rest).to_string(),
        _ => return None,
    };
    let trimmed = decoded.trim_end_matches('\0').trim().to_string();
    (!trimmed.is_empty()).then_some(trimmed)
}

fn utf16_with_bom(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 2 {
        return None;
    }
    match (bytes[0], bytes[1]) {
        (0xff, 0xfe) => Some(utf16(&bytes[2..], false)),
        (0xfe, 0xff) => Some(utf16(&bytes[2..], true)),
        _ => Some(utf16(bytes, false)),
    }
}

fn utf16(bytes: &[u8], big_endian: bool) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| {
            if big_endian {
                u16::from_be_bytes([pair[0], pair[1]])
            } else {
                u16::from_le_bytes([pair[0], pair[1]])
            }
        })
        .collect();
    String::from_utf16_lossy(&units)
}

fn id3v2(bytes: &[u8]) -> Tags {
    if bytes.len() < 10 {
        return Tags::default();
    }
    let major = bytes[3];
    // v2.2 uses three-character frame ids and a different layout; rare enough
    // that the filename fallback is a better use of the code than supporting it.
    if major < 3 {
        return Tags::default();
    }

    let size = syncsafe(&bytes[6..10]);
    let end = (10 + size).min(bytes.len());
    let mut cursor = 10;
    let mut tags = Tags::default();

    while cursor + 10 <= end {
        let id = &bytes[cursor..cursor + 4];
        if id == [0, 0, 0, 0] {
            break; // padding
        }
        let length = if major >= 4 {
            syncsafe(&bytes[cursor + 4..cursor + 8])
        } else {
            be32(&bytes[cursor + 4..cursor + 8])
        };
        let body_start = cursor + 10;
        let body_end = body_start + length;
        if length == 0 || body_end > end {
            break;
        }

        let body = &bytes[body_start..body_end];
        match id {
            b"TIT2" => tags.title = text_frame(body),
            b"TPE1" => tags.artist = text_frame(body),
            b"TALB" => tags.album = text_frame(body),
            _ => {}
        }
        cursor = body_end;
    }

    tags
}

/// The last 128 bytes of an MP3, if somebody's collection predates ID3v2.
fn id3v1(path: &Path) -> Option<Tags> {
    let bytes = fs::read(path).ok()?;
    if bytes.len() < 128 {
        return None;
    }
    let tail = &bytes[bytes.len() - 128..];
    if &tail[0..3] != b"TAG" {
        return None;
    }
    let field = |from: usize, to: usize| {
        let text: String = tail[from..to]
            .iter()
            .take_while(|&&b| b != 0)
            .map(|&b| b as char)
            .collect();
        let trimmed = text.trim().to_string();
        (!trimmed.is_empty()).then_some(trimmed)
    };
    Some(Tags {
        title: field(3, 33),
        artist: field(33, 63),
        album: field(63, 93),
    })
}

fn flac(bytes: &[u8]) -> Tags {
    let mut cursor = 4;
    let mut tags = Tags::default();

    while cursor + 4 <= bytes.len() {
        let header = bytes[cursor];
        let last = header & 0x80 != 0;
        let kind = header & 0x7f;
        let length = ((bytes[cursor + 1] as usize) << 16)
            | ((bytes[cursor + 2] as usize) << 8)
            | bytes[cursor + 3] as usize;
        let body_start = cursor + 4;
        let body_end = body_start + length;
        if body_end > bytes.len() {
            break;
        }

        if kind == 4 {
            tags = vorbis_comment(&bytes[body_start..body_end]);
            break;
        }
        if last {
            break;
        }
        cursor = body_end;
    }

    tags
}

fn vorbis_comment(body: &[u8]) -> Tags {
    let mut tags = Tags::default();
    if body.len() < 8 {
        return tags;
    }
    let vendor = le32(&body[0..4]);
    let mut cursor = 4 + vendor;
    if cursor + 4 > body.len() {
        return tags;
    }
    let count = le32(&body[cursor..cursor + 4]);
    cursor += 4;

    for _ in 0..count.min(512) {
        if cursor + 4 > body.len() {
            break;
        }
        let length = le32(&body[cursor..cursor + 4]);
        cursor += 4;
        if cursor + length > body.len() {
            break;
        }
        let entry = String::from_utf8_lossy(&body[cursor..cursor + length]).to_string();
        cursor += length;

        let Some((key, value)) = entry.split_once('=') else { continue };
        let value = value.trim().to_string();
        if value.is_empty() {
            continue;
        }
        match key.to_ascii_uppercase().as_str() {
            "TITLE" => tags.title = Some(value),
            "ARTIST" => tags.artist = Some(value),
            "ALBUM" => tags.album = Some(value),
            _ => {}
        }
    }

    tags
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal ID3v2.3 tag with one text frame.
    fn id3v3_with(frame: &[u8; 4], text: &str) -> Vec<u8> {
        let mut body = vec![3u8]; // UTF-8
        body.extend_from_slice(text.as_bytes());

        let mut frames = Vec::new();
        frames.extend_from_slice(frame);
        frames.extend_from_slice(&(body.len() as u32).to_be_bytes());
        frames.extend_from_slice(&[0, 0]);
        frames.extend_from_slice(&body);

        let size = frames.len();
        let mut out = b"ID3".to_vec();
        out.extend_from_slice(&[3, 0, 0]);
        out.extend_from_slice(&[
            ((size >> 21) & 0x7f) as u8,
            ((size >> 14) & 0x7f) as u8,
            ((size >> 7) & 0x7f) as u8,
            (size & 0x7f) as u8,
        ]);
        out.extend_from_slice(&frames);
        out
    }

    #[test]
    fn an_id3v2_title_is_read() {
        let bytes = id3v3_with(b"TIT2", "Wild Is the Wind");
        assert_eq!(id3v2(&bytes).title.as_deref(), Some("Wild Is the Wind"));
    }

    #[test]
    fn a_flac_comment_is_read() {
        let vendor = b"test";
        let entries = ["TITLE=Sinnerman", "ARTIST=Nina Simone"];

        let mut body = Vec::new();
        body.extend_from_slice(&(vendor.len() as u32).to_le_bytes());
        body.extend_from_slice(vendor);
        body.extend_from_slice(&(entries.len() as u32).to_le_bytes());
        for entry in entries {
            body.extend_from_slice(&(entry.len() as u32).to_le_bytes());
            body.extend_from_slice(entry.as_bytes());
        }

        let mut file = b"fLaC".to_vec();
        file.push(0x80 | 4); // last block, VORBIS_COMMENT
        file.extend_from_slice(&[
            ((body.len() >> 16) & 0xff) as u8,
            ((body.len() >> 8) & 0xff) as u8,
            (body.len() & 0xff) as u8,
        ]);
        file.extend_from_slice(&body);

        let tags = flac(&file);
        assert_eq!(tags.title.as_deref(), Some("Sinnerman"));
        assert_eq!(tags.artist.as_deref(), Some("Nina Simone"));
    }

    /// Garbage in must not panic: these run over whatever is in a music folder.
    #[test]
    fn a_truncated_tag_is_survivable() {
        assert_eq!(id3v2(b"ID3"), Tags::default());
        assert_eq!(id3v2(b"ID3\x03\x00\x00\x00\x00\x7f\x7fTIT2"), Tags::default());
        assert_eq!(flac(b"fLaC\x84\xff\xff\xff"), Tags::default());
    }
}

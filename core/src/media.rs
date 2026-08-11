//! The rest of the library folder: `music/` for the record player, `artwork/`
//! for the walls, and `video/` for the tapes that go in the television.
//!
//! Deliberately *not* in SQLite. The book index is there because probing a PDF
//! is slow enough to be worth caching and a large collection is tens of
//! thousands of files; a music folder is hundreds and an artwork folder is
//! dozens, so walking them on demand is simpler than a second cache to keep in
//! sync — and a record you dropped in five seconds ago is on the shelf.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use walkdir::WalkDir;

use crate::index::book_id;
use crate::probe::{audio, title_from_filename};

pub const MUSIC_DIR: &str = "music";
pub const ARTWORK_DIR: &str = "artwork";
pub const VIDEO_DIR: &str = "video";

const AUDIO_EXTENSIONS: [&str; 5] = ["mp3", "wav", "flac", "ogg", "m4a"];
const IMAGE_EXTENSIONS: [&str; 5] = ["jpg", "jpeg", "png", "webp", "gif"];
/// What a tape can be.
///
/// Listed rather than probed, and deliberately wider than what will actually
/// play: the WebView plays what Chromium plays, which is roughly H.264 in MP4
/// and VP8/VP9 in WebM. A Matroska file is still a tape in the crate — it goes
/// in the machine, fails to start, and says so in the panel, which is a better
/// answer than pretending the file is not there.
const VIDEO_EXTENSIONS: [&str; 6] = ["mp4", "webm", "m4v", "mov", "mkv", "ogv"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub path: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub format: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artwork {
    pub id: String,
    pub path: String,
    pub title: String,
}

/// A tape in the crate beside the television.
///
/// `series` is the folder it sits in, which for a video folder is very often the
/// thing it belongs to — a season, a director, "holidays 1998". The same
/// convention as a music folder's album, and for the same reason: the shape
/// somebody has already sorted their files into is better metadata than
/// anything a probe would find.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tape {
    pub id: String,
    pub path: String,
    pub title: String,
    pub series: Option<String>,
    pub format: String,
    pub size_bytes: u64,
}

/// `<root>/music`, if it exists. Absent, the library simply has no records —
/// which is not an error, it is a library nobody has put music in.
pub fn music_root(root: &Path) -> Option<PathBuf> {
    let dir = root.join(MUSIC_DIR);
    dir.is_dir().then_some(dir)
}

pub fn artwork_root(root: &Path) -> Option<PathBuf> {
    let dir = root.join(ARTWORK_DIR);
    dir.is_dir().then_some(dir)
}

pub fn video_root(root: &Path) -> Option<PathBuf> {
    let dir = root.join(VIDEO_DIR);
    dir.is_dir().then_some(dir)
}

fn extension_of(path: &Path) -> Option<String> {
    path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase())
}

fn files_under(dir: &Path, allowed: &[&str]) -> Vec<(PathBuf, String)> {
    let mut found: Vec<(PathBuf, String)> = WalkDir::new(dir)
        .max_depth(6)
        .follow_links(false)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| {
            let path = entry.into_path();
            let ext = extension_of(&path)?;
            allowed.contains(&ext.as_str()).then_some((path, ext))
        })
        .collect();

    // Alphabetical by path, so a record shelf is in the order the folder is in
    // rather than in whatever order the filesystem happened to hand over.
    found.sort_by(|a, b| a.0.cmp(&b.0));
    found
}

/// The folder a file sits in, which for a music library is very often the album
/// — and the one above that, which is very often the artist.
fn folder_names(path: &Path, root: &Path) -> (Option<String>, Option<String>) {
    let relative = path.strip_prefix(root).unwrap_or(path);
    let parts: Vec<String> = relative
        .parent()
        .map(|p| {
            p.components()
                .map(|c| c.as_os_str().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();

    match parts.len() {
        0 => (None, None),
        1 => (Some(parts[0].clone()), None),
        n => (Some(parts[n - 2].clone()), Some(parts[n - 1].clone())),
    }
}

/// Every playable file under `<root>/music`, one record each.
///
/// A parser given whatever is on somebody's disk is a parser that will
/// eventually panic, so tag reading runs under the same net the book indexer
/// uses: a track whose tags cannot be read is still a track, under its filename.
pub fn list_tracks(root: &Path) -> Vec<Track> {
    let Some(dir) = music_root(root) else { return Vec::new() };

    files_under(&dir, &AUDIO_EXTENSIONS)
        .into_iter()
        .filter_map(|(path, format)| {
            let id = book_id(&path).ok()?;
            let size_bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            let tags = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| audio::read(&path)))
                .unwrap_or_default();
            let (artist_folder, album_folder) = folder_names(&path, &dir);

            Some(Track {
                id,
                path: path.to_string_lossy().to_string(),
                title: tags.title.unwrap_or_else(|| title_from_filename(&path)),
                artist: tags.artist.or(artist_folder),
                album: tags.album.or(album_folder),
                format,
                size_bytes,
            })
        })
        .collect()
}

/// Every picture under `<root>/artwork`, in folder order.
pub fn list_artwork(root: &Path) -> Vec<Artwork> {
    let Some(dir) = artwork_root(root) else { return Vec::new() };

    files_under(&dir, &IMAGE_EXTENSIONS)
        .into_iter()
        .filter_map(|(path, _)| {
            let id = book_id(&path).ok()?;
            Some(Artwork {
                title: title_from_filename(&path),
                id,
                path: path.to_string_lossy().to_string(),
            })
        })
        .collect()
}

/// Every tape under `<root>/video`, in folder order.
///
/// No probing at all, unlike a book: a container's duration and title sit behind
/// a demuxer, and shipping one to print a nicer label on a cassette is a large
/// dependency for a small gain. The filename is the title, the folder is the
/// series, and the WebView finds out the rest when the tape is played.
pub fn list_videos(root: &Path) -> Vec<Tape> {
    let Some(dir) = video_root(root) else { return Vec::new() };

    files_under(&dir, &VIDEO_EXTENSIONS)
        .into_iter()
        .filter_map(|(path, format)| {
            let id = book_id(&path).ok()?;
            let size_bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            let (outer, inner) = folder_names(&path, &dir);

            Some(Tape {
                id,
                path: path.to_string_lossy().to_string(),
                title: title_from_filename(&path),
                // The nearest folder, which is the more specific of the two.
                series: inner.or(outer),
                format,
                size_bytes,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kleib3ry-media-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_library_with_no_music_folder_simply_has_no_records() {
        let dir = temp_dir("empty");
        assert!(list_tracks(&dir).is_empty());
        assert!(list_artwork(&dir).is_empty());
        assert_eq!(music_root(&dir), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tracks_come_back_with_the_folder_as_artist_and_album() {
        let dir = temp_dir("folders");
        fs::create_dir_all(dir.join("music/Nina Simone/Wild Is the Wind")).unwrap();
        fs::write(dir.join("music/Nina Simone/Wild Is the Wind/04_four_women.mp3"), b"not really an mp3").unwrap();
        // Not audio, and so not a record.
        fs::write(dir.join("music/Nina Simone/sleeve.txt"), b"x").unwrap();

        let tracks = list_tracks(&dir);
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].title, "04 Four Women");
        assert_eq!(tracks[0].artist.as_deref(), Some("Nina Simone"));
        assert_eq!(tracks[0].album.as_deref(), Some("Wild Is the Wind"));
        assert_eq!(tracks[0].format, "mp3");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn artwork_is_listed_in_folder_order() {
        let dir = temp_dir("artwork");
        fs::create_dir_all(dir.join("artwork")).unwrap();
        fs::write(dir.join("artwork/b_lake.png"), b"one").unwrap();
        fs::write(dir.join("artwork/a_pines.jpg"), b"two").unwrap();
        fs::write(dir.join("artwork/notes.md"), b"three").unwrap();

        let pictures = list_artwork(&dir);
        assert_eq!(
            pictures.iter().map(|p| p.title.as_str()).collect::<Vec<_>>(),
            vec!["A Pines", "B Lake"],
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_library_with_no_video_folder_simply_has_no_tapes() {
        let dir = temp_dir("no-video");
        assert!(list_videos(&dir).is_empty());
        assert_eq!(video_root(&dir), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tapes_take_the_folder_as_their_series() {
        let dir = temp_dir("tapes");
        fs::create_dir_all(dir.join("video/Holidays/1998")).unwrap();
        fs::write(dir.join("video/Holidays/1998/03_the_lake.mp4"), b"not really mp4").unwrap();
        fs::write(dir.join("video/notes.txt"), b"x").unwrap();

        let tapes = list_videos(&dir);
        assert_eq!(tapes.len(), 1);
        assert_eq!(tapes[0].title, "03 The Lake");
        // The nearest folder wins: "1998" is more specific than "Holidays".
        assert_eq!(tapes[0].series.as_deref(), Some("1998"));
        assert_eq!(tapes[0].format, "mp4");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Two records with the same bytes are the same record, exactly as two
    /// identical book files are the same book.
    #[test]
    fn identity_is_the_contents_not_the_path() {
        let dir = temp_dir("identity");
        fs::create_dir_all(dir.join("music")).unwrap();
        fs::write(dir.join("music/a.wav"), b"same bytes").unwrap();
        fs::write(dir.join("music/b.wav"), b"same bytes").unwrap();
        fs::write(dir.join("music/c.wav"), b"other bytes").unwrap();

        let tracks = list_tracks(&dir);
        assert_eq!(tracks[0].id, tracks[1].id);
        assert_ne!(tracks[0].id, tracks[2].id);
        let _ = fs::remove_dir_all(&dir);
    }
}

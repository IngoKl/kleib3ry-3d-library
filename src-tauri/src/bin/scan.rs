//! Index a library folder from the command line.
//!
//! The same indexer the app runs, without the app: it walks a folder, reads
//! metadata out of every PDF and EPUB it finds, extracts EPUB cover art, and
//! writes both into `<folder>/.library/`.
//!
//! Useful for indexing a large collection ahead of time, over ssh or from a
//! script, and for reproducing a failing scan with a stack trace and a filename
//! rather than a window disappearing.
//!
//!     npm run scan -- "D:\\Books"
//!     npm run scan -- "D:\\Books" --quiet
//!
//! It cannot produce PDF cover art: those first pages are rasterised by pdf.js
//! inside the app, so the build need not ship a native PDF renderer.

use std::path::PathBuf;
use std::process::ExitCode;

use kleib3ry_lib::{index, media};

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let mut root: Option<PathBuf> = None;
    let mut quiet = false;

    for arg in args.by_ref() {
        match arg.as_str() {
            "--quiet" | "-q" => quiet = true,
            "--help" | "-h" => {
                eprintln!("usage: scan <library folder> [--quiet]");
                return ExitCode::SUCCESS;
            }
            other if other.starts_with('-') => {
                eprintln!("unknown option {other}");
                return ExitCode::from(2);
            }
            other => root = Some(PathBuf::from(other)),
        }
    }

    let Some(root) = root else {
        eprintln!("usage: scan <library folder> [--quiet]");
        return ExitCode::from(2);
    };
    if !root.is_dir() {
        eprintln!("not a directory: {}", root.display());
        return ExitCode::from(2);
    }

    // Through `save_files` rather than by hand, so this and the app cannot
    // disagree about where a library keeps its index.
    let files = kleib3ry_core::save_files(&root);
    let covers = files.covers;
    let index_path = files.index;
    if let Err(e) = std::fs::create_dir_all(&covers) {
        eprintln!("cannot write to {}: {e}", root.join(".library").display());
        return ExitCode::FAILURE;
    }

    // Which folder is read is worth saying out loud: `music/` and `artwork/`
    // are part of a library folder too, and a scan that quietly indexed the
    // sleeve notes would look like the book count being wrong for no reason.
    match index::books_root(&root) {
        Some(books) => println!("scanning {}", books.display()),
        None => println!(
            "scanning {} — no books/ folder, so reading the whole thing",
            root.display()
        ),
    }
    println!("index    {}", index_path.display());
    println!("covers   {}", covers.display());

    // The file being read is printed *before* it is parsed, so if a book takes
    // the process down its name is the last thing on screen.
    let report = |progress: index::ScanProgress| {
        if quiet {
            return;
        }
        if progress.done % 25 == 0 || progress.done >= progress.total {
            println!("  {:>6}/{:<6} {}", progress.done, progress.total, progress.current);
        }
    };

    match index::scan(&root, &index_path, &covers, report) {
        Ok(summary) => {
            println!(
                "\n{} found · {} new · {} unchanged · {} gone · {} unreadable",
                summary.found,
                summary.added,
                summary.unchanged,
                summary.removed,
                summary.failed,
            );
            if summary.failed > 0 {
                println!("(unreadable books are still indexed, under their filename)");
            }

            // The rest of the library folder. Music and artwork are deliberately
            // not in the index — the app walks them on demand — but a scan should
            // still read them, because this is where you find out the folder
            // layout is wrong *before* the record shelf stands empty.
            match media::music_root(&root) {
                Some(_) => {
                    let tracks = media::list_tracks(&root);
                    println!("music    {} track(s)", tracks.len());
                }
                None => println!("music    no music/ folder"),
            }
            match media::artwork_root(&root) {
                Some(_) => {
                    let artwork = media::list_artwork(&root);
                    println!("artwork  {} picture(s)", artwork.len());
                }
                None => println!("artwork  no artwork/ folder"),
            }

            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("\nscan failed: {e}");
            ExitCode::FAILURE
        }
    }
}

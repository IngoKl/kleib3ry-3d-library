//! Index a library folder from the command line — the same indexer the app runs,
//! writing into `<folder>/.library/`. Useful ahead of time, over ssh, and for
//! reproducing a failing scan with a filename instead of a vanished window.
//!
//!     npm run scan -- "D:\\Books" [--quiet]
//!
//! No PDF cover art: those pages are rasterised by pdf.js inside the app.

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

    // Worth saying out loud: a scan that quietly indexed the sleeve notes looks
    // like the book count being wrong for no reason.
    match index::books_root(&root) {
        Some(books) => println!("scanning {}", books.display()),
        None => println!(
            "scanning {} — no books/ folder, so reading the whole thing",
            root.display()
        ),
    }
    println!("index    {}", index_path.display());
    println!("covers   {}", covers.display());

    // Printed before parsing, so a book that takes the process down leaves its
    // name as the last thing on screen.
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

            // Not indexed, but still counted here: this is where you find out
            // the folder layout is wrong, before the record shelf stands empty.
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

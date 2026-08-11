//! Index a library folder from the command line.
//!
//! The same indexer the app runs, without the app: it walks a folder, reads
//! metadata out of every PDF and EPUB it finds, extracts EPUB cover art, and
//! writes both into `<folder>/.library/`.
//!
//! It exists for two reasons. Indexing a large collection is slow and worth
//! being able to do ahead of time, or over ssh, or from a script. And when a
//! scan goes wrong, this reproduces it with a stack trace and a filename
//! instead of a window disappearing.
//!
//!     npm run scan -- "D:\\Books"
//!     npm run scan -- "D:\\Books" --quiet
//!
//! What it cannot do: PDF cover art. Those first pages are rasterised by pdf.js
//! inside the app, so that the build does not have to ship a native PDF
//! renderer — they are filled in the first time you look at the book.

use std::path::PathBuf;
use std::process::ExitCode;

use library3d_lib::index;

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

    let save = root.join(".library");
    let covers = save.join("covers");
    let database = save.join("index.sqlite");
    if let Err(e) = std::fs::create_dir_all(&covers) {
        eprintln!("cannot write to {}: {e}", save.display());
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
    println!("index    {}", database.display());
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

    match index::scan(&root, &database, &covers, report) {
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
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("\nscan failed: {e}");
            ExitCode::FAILURE
        }
    }
}

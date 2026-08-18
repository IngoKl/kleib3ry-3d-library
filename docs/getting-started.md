# Getting Started

There are two ways to run kleib3ry — the desktop app and the container — and
this page is the desktop one. [modes.md](modes.md) is the difference between
them; [docker.md](docker.md) is how to run the other.

## Run It

```bash
npm install
npm run assets         # pdf.js fonts and cmaps, and a sample book, into public/
npm run tauri:dev      # the desktop app
```

`npm run assets` writes generated files that are deliberately not committed;
reading will fail without it.

If you only want to look round the room, `npm run dev` opens it in a browser tab
with a generated 1,700-book stand-in library and no filesystem access at all.
That is a test fixture rather than a third way to run it — see
[modes.md](modes.md#the-third-driver-is-not-a-third-mode).

## Try It Without Your Own Books

There is a small real library in the repository, at
[demo-data/demo-library/](../demo-data/demo-library/): ten
[Standard Ebooks](https://standardebooks.org/) titles, two records, two
pictures, a tape and a Pong cartridge for the arcade machine, all freely
licensed — the credits are in the folder's own
[README](../demo-data/demo-library/README.md).

Point the app at it like any other library folder with **Choose Folder…** — the
scan starts by itself. It fills four boxes rather than a room, which is enough
to unpack a shelf, put a record on and read something. The container can use it
too:

```bash
docker run --rm -p 127.0.0.1:8080:8080 -v "$PWD/demo-data/demo-library:/library" kleib3ry
```

Whichever you use writes into that folder's `.library/`, so the demo library
remembers where you put things exactly as your own would. It ships with an index,
a cover cache and a layout already committed, while the `library.json` and
`ambience.json` written beside them are gitignored. To put it back the way it
shipped: delete those two and `git restore demo-data/demo-library`.

## Point It at Your Books

Press **Choose Folder…** in the panel and pick a folder. The scan starts on its
own — how far it has got, and roughly how long is left, shows where you are: in
the menu, in the settings panel and in the status strip. **Scan** is still there
for looking at the same folder again after its contents change.

The folder wants to look like this. Only `books/` is needed; the rest is what
turns a shelf of books into a room you want to be in.

```text
My Library/
  books/        your PDFs and EPUBs, in whatever folders you like
  music/        one record per file, for the record player
  artwork/      one picture per file, for the frames on the wall
  video/        one tape per file, for the television
  roms/         one game cartridge per .ch8 file, for the arcade machine
```

The app then creates `.library/` beside them for everything it writes — the
index, the cover cache, which book is on which shelf, and the room itself.
Nothing it writes ever lands among your books. The whole thing is described in
[library-folder.md](library-folder.md).

A first scan of a large collection takes a while, and rasterising cover art takes
longer: covers are warmed in the background, so the shelves fill in over the first
few minutes and are read off disk instantly every launch after that.

## Your Library Arrives in Boxes

The shelves start **empty**, and everything the scan found is stacked in the
four moving boxes on the floor of the great room. Nothing shelves itself.

Unpacking is something you do:

- Look at a box and press **`G`** to tip the whole thing onto the empty shelves.
- Or press **`E`** to take one book out, walk it somewhere, and press **`E`**
  again to put it on a shelf.
- Press **`X`** to pick the box up and carry it somewhere first.
- Changed your mind about a book? **`E`** into any box puts it back.

Press **`,`** and **`.`** (or the mouse wheel) to riffle down through a box: it
holds far more than the pile on top can show.

## Finding Your Way Round

The app opens on a menu: which library folder, then **Go In**. The room is
already loading behind it, so the button is instant. **`F2`** is settings, from
the menu or the room — that is where **Low Performance Mode** lives if the room
is stuttering.

You start in the great room, looking north at the lake. Click to capture the
mouse; `Esc` releases it. **`F1`** brings up every key.

The building is a cabin: a great room with a hearth, a clock and a loft up a
flight of stairs, a reading corner with a bedroom above it, a kitchen, a bathroom
off the kitchen, an office with a whiteboard, and a porch. Straight out of the
porch door and down the steps there is grass, a path round the pond, and a trail
west to the lake house on the far shore.

Things worth trying early:

|                                               |                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| **`F`** at a book                             | draws it out of the shelf to show you its cover                         |
| **`R`** with a book in hand                   | opens it — drag a page across to turn it                                |
| **`ctrl`**                                    | kneel, to read the bottom shelf                                         |
| **`Z`** (or right mouse)                      | zoom, to read a spine across the room                                   |
| **`E`** on a lamp, the deck, the coffee maker | works it                                                                |
| **`E`** on a record, then on a deck           | puts music on; **`F`** takes it back off                                |
| **`E`** on a tape, then on the television     | plays it; **`F`** takes it back out                                     |
| **`E`** on the ROM box, then on the arcade    | boots the game; **`E`** again steps up to play, **`Esc`** steps away    |
| **`E`** on the marker in the office           | picks it up — then hold the left mouse button to draw on the whiteboard |
| **`E`** on the switch by the porch door       | works every light in the library at once                                |
| **`E`** on the coffee maker, twice            | puts a pot on, then hands you the cup; **`F`** drinks it                |
| **`E`** on the headlamp on the porch table    | wears it — hands free, and the beam follows your eyes                   |
| **`E`** on the kitchen telephone              | orders a delivery; somebody walks it out of the trees to the steps      |
| **`L`** at a bookcase                         | writes on its label                                                     |
| **`P`** while reading                         | tears out a copy of the page — the book keeps its own                   |
| **`T`**                                       | writes a note; **`E`** at a wall pins either one up                     |
| **`N`**                                       | night, and back                                                         |
| **`K`**                                       | rain, and back — you can hear it, louder outside                        |
| **`E`** at the office terminal                | searches the whole library and says where a thing is                    |
| **`V`**                                       | calls the cat; **`E`** makes a fuss of it, **`F`** asks it for a book   |
| **`H`**                                       | hides the interface                                                     |

## The Room Is a File

`<your library folder>/.library/library.json` is the building: rooms, openings,
bookcases, furniture, lamps, roofs. Edit it in any editor and **the room reloads
while you are standing in it**.

If an edit is wrong, the room you are in keeps running and the panel names the
path that is wrong, so you cannot break your library by mistyping. The app never
writes to that file: where you shoved the boxes and what you wrote on a shelf go
to `books.json` beside it, so your comments and formatting are safe.

The full guide is [custom-maps.md](custom-maps.md). To start over, delete
`library.json` and a fresh default is written the next time you open the library.

## If Something Looks Wrong

The panel is the first place to look. It shows which driver is live, which folder
is open, which files this library is saved into, how many books are shelved and
how many are still boxed, and any error from the last scan or the last edit.

- **An empty library.** Check the panel's folder, and which driver it says is
  live: a browser tab without the desktop shell has no filesystem and shows a
  stand-in catalogue, which is the usual answer to "why are these not my books".
- **Books with no cover art.** They are still warming. A PDF's first page is
  rasterised once, ever, and cached in `.library/covers/`.
- **A book that will not open.** Both formats open — a PDF through pdf.js, an
  EPUB unzipped and set in type by the app. What an EPUB cannot keep is its own
  layout: it is re-set, so page numbers are the app's, not the publisher's.
- **A tape that will not play.** The container it is in has to be one the WebView
  can decode — roughly H.264 in MP4, VP8 or VP9 in WebM. The panel says why.

# Controls

Every key, in one place. `F1` shows the same keys inside the room, grouped the
same way, which is where you will actually look them up.

There are no modes to choose. You are walking, or you are reading a book you
opened — and `Esc` gets you out of the second.

## Moving

- **click** — capture the mouse to look around; `Esc` releases it.
- **`W` `A` `S` `D`** — walk. **`shift`** runs.
- **`ctrl`** — kneel, to read the bottom shelf. Held, not toggled.
- **`Z`** — zoom in, also held. The right mouse button does the same.

## Hands

`E` is the reach: it takes what is under the crosshair, or puts down what is in
your hand.

- **`E`** — take the book under the crosshair, or put the one you are holding on
  a shelf, in a box, or on the table you are looking at.
- **`E`** — sit down in the seat you are looking at, with a book in hand if
  reading is the plan.
- **`E`** — work the thing you are looking at: a lamp, the light switch by the
  porch door, the coffee maker, the catalogue terminal. Or take a note off the
  pad.
- **`E`** — pin the sheet in your hand to a wall or a whiteboard, or take one
  down again.
- **`Q`** — drop the book you are holding; it falls, tumbles and stays where it
  lands. A sheet of paper is thrown away; a record, a tape or the marker goes
  back where it came from.
- **`O`** — put the book down open, at the page you were on.
- **`F`** — draw the book under the crosshair out to look at its cover.
- **`R`** — read the book in your hand — PDF or EPUB.
- **`G`** — empty the box you are looking at onto the shelves, nearest bookcase
  first.
- **`X`** — pick up the moving box you are looking at and carry it; `X` again
  sets it down.
- **`Backspace`** — break down an empty box. Flattened spares wait on the stack
  in the kitchen, and `E` takes one.
- **`,`** **`.`** — riffle down through the box you are looking at. The mouse
  wheel does it too.
- **`L`** — write a label on the bookcase you are aiming at.
- **`T`** — write a note to pin up, then `E` at whatever wall you want it on.

## Records and Tapes

- **`E`** — take one out of a crate; then put a record on a deck or a tape in
  the television, file it in any crate, or set a record down on a table.
- **`F`** — take the record back off the deck, or the tape back out of the
  television.
- **`Q`** — send it back to the crate the folder deals it into.

## The Whiteboard

- **`E`** — pick the marker up off the office desk, and put it back.
- **drag** — hold the left mouse button and the line follows the crosshair.
- **`F`** — change pen. **`G`** wipes the board you are looking at.

## The Cat

- **`V`** — call it. It comes if it feels like it.
- **`E`** — make a fuss of it, when it is under the crosshair.
- **`F`** — ask it for a book; it picks one off a shelf and brings it to you.

## Reading

- **drag** — pull a page across to turn it. Let go early and it falls back.
- **`←`** **`→`** — turn pages without dragging.
- **`B`** — put a bookmark in the page you are on, or take it out again.
- **`P`** — tear out a copy of the page. The book keeps its own.
- **`J`** — go to a page by number.
- **`Esc`** — close the book.

## The Room

- **`N`** — day to night, and back.
- **`K`** — rain on and off. You hear it as well as see it: loud on the grass,
  muffled indoors.
- **`E`** at the office terminal — search the whole library and it says where a
  thing is.
- **`H`** — hide the interface, and bring it back.
- **`F1`** — this card, in the room. **`F2`** — settings.

## Bookmarks

Bookmarks are slips standing out of the top of the book, placed along its width
by how far in they are, and each one is a different colour with a stitched edge
so several in one book stay tellable apart. Click one to open the book there.
They are saved with the library, so they are still in it next time.

A book you leave open stays open: it lies there showing the spread you were on,
and picking it up again and pressing `R` puts you back on that page.

## The Menu and Settings

The app opens on a main menu: which library folder, and then **Go In**. The room
loads _behind_ it, so choosing is a decision rather than a wait, and nothing you
press reaches the room until you have gone in. In the container there is nothing
to choose — the library is the folder that was mounted — so the menu says so and
the button is off; see [modes.md](modes.md).

Settings are `F2`, from the menu or from the room. Most of them are about your
machine rather than about your library — **Low Performance Mode** (no shadows,
no window light, one pixel per pixel, for an older GPU), **Show My Body**,
**Interface**, **Mouse Sensitivity**, **Volume**, **Rain Volume**, **Sound in
the Room**, and **One Box per Folder**, which decides whether a scan levels new
books across the moving boxes or gives each folder of `books/` a box of its own.
Those are kept in browser storage keyed by the app, so a library folder you copy
to another computer does not carry an opinion about that computer's GPU.

**Night** and **Rain** are on the same card but are not the same kind of thing:
along with which lamps are on, they are facts about the room, so they live in
the library folder in `.library/ambience.json` and come back with it.

# Controls

Every key, in one place. `F1` shows the same table inside the room, which is
where you will actually look it up.

There are no modes to choose. You are walking, or you are reading a book you
opened — and `Esc` gets you out of the second.

| | |
| --- | --- |
| click | capture the mouse to look around (`Esc` releases) |
| `W` `A` `S` `D` | walk |
| `shift` | run |
| `ctrl` | kneel, to read the bottom shelf — held, not toggled |
| `Z` | zoom in — held, like kneeling. The right mouse button does the same |
| `E` | take the book, record or tape under the crosshair; put it on the shelf, in the box, on the table, on the deck or in the television you are looking at; pin the sheet in your hand to a wall, or take one down; sit down — with a book in hand, if reading is the plan; switch a lamp; put the coffee on; search the catalogue; take a note off the pad; make a fuss of the cat |
| `Q` | drop the book you are holding — it falls, tumbles and stays where it lands; a record or a tape files itself back where it came from; a sheet of paper is thrown away |
| `O` | put it down open, at the page you were on |
| `G` | empty the box you are looking at onto the shelves |
| `X` | pick up the moving box you are looking at and carry it; `X` again sets it down |
| `,` `.` | riffle down through the box you are looking at (the mouse wheel does it too) |
| `L` | write a label on the bookcase you are aiming at |
| `T` | write a note to pin up — then `E` at whatever wall you want it on |
| `F` | draw the book under the crosshair out to look at its cover — or, aimed at the cat, ask it to fetch you one |
| `R` | read the book in your hand — PDF or EPUB |
| `V` | call the cat |
| drag | while reading, drag a page across to turn it — let go early and it falls back |
| `←` `→` | turn pages without dragging; `Esc` closes the book |
| `B` | put a bookmark in the page you are on, or take it out again |
| `P` | while reading, tear out a copy of the page — the book keeps its own |
| `J` | while reading, go to a page by number |
| `N` | day to night and back |
| `K` | rain on and off |
| `H` | hide the interface, and bring it back |
| `F1` | the controls card, in the room |
| `F2` | settings |

## Bookmarks

Bookmarks are slips standing out of the top of the book, placed along its width
by how far in they are, and each one is a different colour with a stitched edge
so several in one book stay tellable apart. Click one to open the book there.
They are saved with the library, so they are still in it next time.

A book you leave open stays open: it lies there showing the spread you were on,
and picking it up again and pressing `R` puts you back on that page.

## The menu, and settings

The app opens on a main menu: which library folder, and then **go in**. The room
loads *behind* it, so choosing is a decision rather than a wait, and nothing you
press reaches the room until you have gone in. In the container there is nothing
to choose — the library is the folder that was mounted — so the menu says so and
the button is off; see [modes.md](modes.md).

Settings are `F2`, from the menu or from the room, and they are the things that
are about your machine rather than about your library — **low performance mode**
(no shadows, no window light, one pixel per pixel, for an older GPU), whether you
can see your own body, the volume, whether sound is placed in the room, and the
mouse sensitivity. They are kept in browser storage keyed by the app, so a
library folder you copy to another computer does not carry an opinion about that
computer's GPU.

What *is* about the library — which lamps are on, whether it is night, whether it
is raining — stays in the library folder, in `.library/lights.json`, and comes
back with it.

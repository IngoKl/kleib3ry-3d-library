import { expect, test, type Page } from '@playwright/test'

type Stats = {
  fps: number
  drawCalls: number
  triangles: number
  frames: number
  mode: string
  driver: string
  rootLoaded: boolean
  focusedBook: string | null
  held: string | null
  reading: string | null
  shelfTarget: ShelfTarget | null
  books: number
  shelved: number
  boxed: number
  boxes: number
  reconciliation: string | null
  libraryError: string | null
  worldError: string | null
  rooms: number
  shelves: number
  worldRevision: number
}

type ShelfTarget = { shelf: number; shelfId: string; row: number; index: number }

type Book = { id: string; title: string; author: string | null; format: string }

type ReaderStatus = {
  bookId: string | null
  pages: number
  spread: number
  progress: number
  rendered: boolean
  showing: [number, number] | null
  turning: boolean
  failure: string | null
}

declare global {
  interface Window {
    __app: {
      ready: () => boolean
      stats: () => Stats
      player: () => {
        x: number
        z: number
        yaw: number
        pitch: number
        speed: number
        eye: number
        /** Height of the floor underfoot. Zero everywhere but the loft. */
        floor: number
        crouch: number
      }
      focusedBook: () => Book | null
      heldBook: () => Book | null
      shelfTarget: () => ShelfTarget | null
      focusedSeat: () => string | null
      focusedBox: () => string | null
      boxTarget: () => string | null
      seat: () => string | null
      rowsOf: (shelfId: string, row: number) => string[]
      savedRowsOf: (shelfId: string, row: number) => string[]
      boxedBooks: () => string[]
      boxContents: (boxId: string) => string[]
      savedBoxContents: (boxId: string) => string[]
      emptyBoxForTest: (boxId: string) => number
      boxView: (boxId: string) => { offset: number; shown: number; total: number } | null
      visibleInBoxes: () => string[]
      boxIds: () => string[]
      places: () => {
        shelves: { id: string; x: number; z: number; rotationY: number; rows: number }[]
        boxes: { id: string; x: number; z: number; height: number }[]
      }
      room: () => string | null
      worldText: () => string | null
      editWorld: (text: string) => Promise<string | null>
      /** `floor` puts you on a particular storey; omitted, you keep the one you are on. */
      teleport: (x: number, z: number, yaw?: number, floor?: number) => void
      looseBooks: () => Record<
        string,
        { x: number; y: number; z: number; yaw: number; open: boolean; spread: number }
      >
      putDownForTest: (
        id: string,
        placement: { x: number; y: number; z: number; yaw: number; open: boolean; spread: number },
      ) => void
      night: () => boolean
      toggleNightForTest: () => boolean
      furniture: () => { id: string; kind: string; room: string; x: number; y: number; z: number }[]
      packEverythingForTest: () => number
      labelOf: (shelfId: string) => string | null
      setLabelForTest: (shelfId: string, text: string) => void
      lights: () => Record<string, boolean>
      toggleLightForTest: (id: string) => boolean | null
      records: () => string[]
      nowPlaying: () => string | null
      artwork: () => string[]
      look: (yaw: number, pitch?: number) => void
      reader: () => ReaderStatus
      readForTest: (id: string) => Promise<ReaderStatus>
      setModeForTest: (mode: string) => void
      bookmarksOf: (id: string) => number[]
      spines: () => { printed: number; slots: number; reprinted: number }
    }
  }
}

async function boot(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => window.__app?.ready() === true, null, { timeout: 30_000 })
}

/**
 * Unpack every box onto the shelves.
 *
 * A newly indexed library arrives boxed and stays that way until you unpack it,
 * so most of what follows — taking a book off a shelf, printing spines, losing
 * a bookcase — starts by doing what you would do first in the room.
 */
async function unpackEverything(page: Page) {
  const shelved = await page.evaluate(() =>
    window.__app.boxIds().reduce((total, id) => total + window.__app.emptyBoxForTest(id), 0),
  )
  expect(shelved, 'nothing came out of the boxes').toBeGreaterThan(100)
  await page.waitForTimeout(300)
  return shelved
}

/**
 * Wait for the crosshair to report something, or give up on this pose.
 *
 * Everything the crosshair knows is written by a raycast that runs every other
 * frame, so the question "has it noticed yet" is answered in frames, not in
 * milliseconds — and one frame here is however long a software rasteriser takes
 * over the whole cabin. Sweeping poses on a fixed sleep therefore reads stale
 * nulls under load and finds nothing anywhere, which looks exactly like the
 * room being wrong.
 *
 * Resolves false rather than throwing, because "not from this pose" is the
 * normal answer for most of the poses these helpers try.
 */
async function settled(page: Page, condition: () => boolean, timeout = 4000) {
  try {
    await page.waitForFunction(condition, null, { timeout, polling: 100 })
    return true
  } catch {
    return false
  }
}

/**
 * Stand in front of a bookcase, looking at a compartment with something in it.
 *
 * Derived from the world rather than written down as coordinates: the map is a
 * document somebody edits, and a test that knows where the bookcases *were* is
 * a test that fails the day the room is rearranged. Which rows are stocked is
 * not fixed either — unpacking a box fills empty rows in a shuffled order — so
 * this sweeps the height of a case until the crosshair finds a book, or, when
 * carrying one, a shelf to put it on.
 */
async function faceTheShelves(page: Page) {
  const shelves = (await page.evaluate(() => window.__app.places())).shelves
  expect(shelves.length, 'this world has no bookcases').toBeGreaterThan(0)

  for (const shelf of shelves.slice(0, 6)) {
    for (const pitch of [-0.1, -0.4, 0.2, -0.65, 0.45]) {
      await page.evaluate(
        ([shelf, pitch]) => {
          const s = shelf as { x: number; z: number; rotationY: number }
          // Standing on the case's open side, looking straight into it.
          const x = s.x + Math.sin(s.rotationY) * 0.85
          const z = s.z + Math.cos(s.rotationY) * 0.85
          window.__app.teleport(x, z, s.rotationY)
          window.__app.look(s.rotationY, pitch as number)
        },
        [shelf, pitch] as const,
      )
      /**
       * Wait for the crosshair to answer rather than for a fixed moment. The
       * raycast runs every other frame, so "how long until the store catches
       * up" is a number of *frames* — and a headless software rasteriser
       * drawing a forest and seventeen hundred books can take longer over one
       * frame than any sleep short enough to sweep thirty poses with.
       *
       * What counts as an answer depends on what is in your hands, and asking
       * for "either" is how this used to return happily from a pose that had
       * found a book while the caller went on to need a shelf.
       */
      const found = await settled(page, () =>
        window.__app.heldBook() !== null
          ? window.__app.shelfTarget() !== null
          : window.__app.focusedBook() !== null,
      )
      if (found) return
    }
  }
}

test('the room renders and the library arrives in boxes', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))

  await boot(page)
  await expect(page.locator('canvas')).toBeVisible()
  await page.waitForTimeout(2000)

  const stats = await page.evaluate(() => window.__app.stats())

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
  expect(stats.rootLoaded).toBe(true)
  expect(stats.mode).toBe('walk')
  expect(stats.driver).toBe('browser')
  expect(stats.libraryError).toBeNull()

  expect(stats.drawCalls).toBeGreaterThan(5)
  expect(stats.triangles).toBeGreaterThan(1000)
  /**
   * Alive and rendering, not a frame-rate target. This runs on SwiftShader, a
   * software rasteriser, where the printed spines cost a texture fetch per
   * fragment across a thousand-odd boxes — free on a GPU, expensive here. The
   * threshold was 30 when books were flat colours; it is deliberately loose
   * because what it is testing is that frames keep coming.
   */
  expect(stats.frames).toBeGreaterThan(18)

  // Books came from the service, and every one of them is in a box: the app
  // does not arrange a library it has just found on your behalf.
  expect(stats.books).toBeGreaterThan(100)
  expect(stats.shelved).toBe(0)
  expect(stats.boxed).toBe(stats.books)
  expect(stats.boxes).toBe(4)
  await expect(page.getByTestId('unpack-hint')).toBeVisible()

  await page.screenshot({ path: 'tests/screenshots/boxed.png' })

  // And unpacking them is one interaction per box.
  await unpackEverything(page)
  const unpacked = await page.evaluate(() => window.__app.stats())
  expect(unpacked.shelved).toBeGreaterThan(100)
  expect(unpacked.boxed).toBe(unpacked.books - unpacked.shelved)
  await expect(page.getByTestId('unpack-hint')).toHaveCount(0)

  await page.screenshot({ path: 'tests/screenshots/room.png' })
})

test('walking moves the player and walls stop them', async ({ page }) => {
  await boot(page)

  const start = await page.evaluate(() => {
    window.__app.teleport(0, 1.5, Math.PI)
    return window.__app.player()
  })

  await page.locator('canvas').click({ position: { x: 400, y: 400 } })
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(1200)
  await page.keyboard.up('KeyW')
  await page.waitForTimeout(200)

  const after = await page.evaluate(() => window.__app.player())
  expect(after.z).toBeGreaterThan(start.z + 0.3)

  await page.keyboard.down('KeyW')
  await page.waitForTimeout(2500)
  await page.keyboard.up('KeyW')
  expect((await page.evaluate(() => window.__app.player())).z).toBeLessThan(3)
})

test('take a book, then shelve it somewhere else', async ({ page }) => {
  await boot(page)
  await unpackEverything(page)
  await faceTheShelves(page)

  const focused = await page.evaluate(() => window.__app.focusedBook())
  expect(focused).not.toBeNull()
  await expect(page.getByTestId('focus-card')).toContainText(focused!.title)

  // Take it: it leaves the shelf and the shelved count drops.
  const before = await page.evaluate(() => window.__app.stats().shelved)
  await page.keyboard.press('KeyE')
  await page.waitForTimeout(400)

  const held = await page.evaluate(() => window.__app.heldBook())
  expect(held?.id).toBe(focused!.id)
  expect(await page.evaluate(() => window.__app.stats().shelved)).toBe(before - 1)
  await expect(page.getByTestId('held-card')).toContainText(focused!.title)

  await page.screenshot({ path: 'tests/screenshots/holding.png' })

  // Holding a book, the crosshair targets a shelf rather than another book.
  const target = await page.evaluate(() => window.__app.shelfTarget())
  expect(target).not.toBeNull()

  await page.keyboard.press('KeyE')
  await page.waitForTimeout(400)

  expect(await page.evaluate(() => window.__app.heldBook())).toBeNull()
  expect(await page.evaluate(() => window.__app.stats().shelved)).toBe(before)

  // It really landed in the row that was targeted.
  const row = await page.evaluate(
    ([shelfId, index]) => window.__app.rowsOf(shelfId as string, index as number),
    [target!.shelfId, target!.row],
  )
  expect(row).toContain(focused!.id)
})

test('a placement survives a reload', async ({ page }) => {
  await boot(page)
  await unpackEverything(page)
  await faceTheShelves(page)

  const moved = await page.evaluate(() => window.__app.focusedBook())
  expect(moved, 'nothing was under the crosshair to take').not.toBeNull()
  await page.keyboard.press('KeyE')
  await settled(page, () => window.__app.heldBook() !== null)

  // Holding a book, the crosshair looks for a shelf rather than a book — which
  // is not always satisfied by the pose that found a book to pick up, since
  // taking one can leave the crosshair pointing through the gap it left. Re-aim
  // rather than assume.
  await settled(page, () => window.__app.shelfTarget() !== null)
  let target = await page.evaluate(() => window.__app.shelfTarget())
  if (!target) {
    await faceTheShelves(page)
    target = await page.evaluate(() => window.__app.shelfTarget())
  }
  expect(target, 'not aiming at a bookcase').not.toBeNull()
  await page.keyboard.press('KeyE')
  // The layout save is debounced; give it time to land.
  await page.waitForTimeout(1200)

  await page.reload()
  await page.waitForFunction(() => window.__app?.ready() === true, null, { timeout: 30_000 })

  const row = await page.evaluate(
    ([shelfId, index]) => window.__app.rowsOf(shelfId as string, index as number),
    [target!.shelfId, target!.row],
  )
  expect(row).toContain(moved!.id)
})

test('reading a book drops the crosshair, and there is no mode to get stuck in', async ({
  page,
}) => {
  await boot(page)
  await unpackEverything(page)
  await faceTheShelves(page)
  expect(await page.evaluate(() => window.__app.stats().focusedBook)).not.toBeNull()

  // There are no mode buttons any more: walking and reading are the only two
  // states, and reading is somewhere you arrive rather than somewhere you pick.
  await expect(page.getByRole('button', { name: 'edit', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'walk', exact: true })).toHaveCount(0)

  // Read mode with no book used to be selectable, and froze the camera with no
  // way back. Asking for it directly is refused.
  expect(
    await page.evaluate(() => {
      window.__app.setModeForTest('read')
      return window.__app.stats().mode
    }),
  ).toBe('walk')

  await page.evaluate(() => window.__app.readForTest('sample-book'))
  const stats = await page.evaluate(() => window.__app.stats())
  expect(stats.mode).toBe('read')
  expect(stats.focusedBook).toBeNull()

  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  expect(await page.evaluate(() => window.__app.stats().mode)).toBe('walk')
})

test('indexing controls are disabled without the desktop shell', async ({ page }) => {
  await boot(page)
  await expect(page.getByRole('button', { name: /choose folder/i })).toBeDisabled()
  await expect(page.getByRole('button', { name: /^scan$/i })).toBeDisabled()
  await expect(page.getByTestId('book-count')).toContainText('books')
})

test('a page turn never exposes the spread it turned away from', async ({ page }) => {
  await boot(page)

  const opened = await page.evaluate(() => window.__app.readForTest('sample-book'))
  expect(opened.failure).toBeNull()
  expect(opened.pages).toBe(12)
  expect(opened.rendered).toBe(true)
  // Leaf s carries pages 2s+1 and 2s+2, so the first spread is a blank verso
  // facing page 1 — a title page on the right, as a real book opens.
  expect(opened.showing).toEqual([0, 1])

  await page.keyboard.press('ArrowRight')

  // Sample right through the turn. The leaf is what hides the swap, so the
  // ordering that matters is: it may not come down until the destination spread
  // is already on the sheets. Dropping it first is what produced "old page,
  // then loading, then the new page" — the leaf landed, the stale spread was
  // exposed, and pdf.js was still rasterising the replacement.
  const samples = await page.evaluate(async () => {
    const seen: { spread: number; showing: [number, number] | null; turning: boolean }[] = []
    let started = false
    // Sample until the turn has been seen to start and finish. Under
    // SwiftShader a turn takes several seconds, so a fixed window is a coin
    // flip; the loop is bounded only so a stuck turn fails rather than hangs.
    for (let i = 0; i < 600; i++) {
      const status = window.__app.reader()
      seen.push({ spread: status.spread, showing: status.showing, turning: status.turning })
      started ||= status.turning
      if (started && !status.turning && status.spread === 1) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return seen
  })

  const turnStarted = samples.findIndex((s) => s.turning)
  expect(turnStarted, 'the leaf never appeared, so nothing was tested').toBeGreaterThanOrEqual(0)

  for (const sample of samples.slice(turnStarted)) {
    // Every frame after the leaf goes up, the sheets must agree with the
    // committed spread; and once it is down, the commit must already have
    // happened rather than being some rasterises away.
    expect(sample.showing).not.toBeNull()
    expect(sample.showing![0]).toBe(2 * sample.spread)
    if (!sample.turning) expect(sample.spread).toBe(1)
  }

  expect(samples.at(-1)!.turning).toBe(false)
  expect(samples.at(-1)!.spread).toBe(1)
  expect(samples.at(-1)!.showing).toEqual([2, 3])
})

/** Edit the live world document by replacing a fragment of its text. */
async function editWorld(page: Page, from: string, to: string) {
  return page.evaluate(
    ([from, to]) => {
      const text = window.__app.worldText()
      if (text === null || !text.includes(from as string)) {
        throw new Error(`world text has no ${from}`)
      }
      return window.__app.editWorld(text.replace(from as string, to as string))
    },
    [from, to],
  )
}

test('the library opens in rooms you can walk between', async ({ page }) => {
  await boot(page)

  const stats = await page.evaluate(() => window.__app.stats())
  expect(stats.rooms).toBe(5)
  expect(stats.worldError).toBeNull()
  expect(await page.evaluate(() => window.__app.room())).toBe('main')

  // Through the doorway on the west wall and into the reading corner. Walking
  // is timed in simulation steps, and headless runs well under the 20 fps the
  // movement delta is clamped at, so this waits on arrival rather than on a
  // duration that would only be right on this machine.
  await page.evaluate(() => window.__app.teleport(-3.4, 0.9, Math.PI / 2))
  await page.locator('canvas').click({ position: { x: 400, y: 400 } })
  await page.keyboard.down('KeyW')
  try {
    await page.waitForFunction(() => window.__app.room() === 'reading', null, { timeout: 25_000 })
  } finally {
    await page.keyboard.up('KeyW')
  }

  expect(await page.evaluate(() => window.__app.room())).toBe('reading')
})

test('the loft is a room you climb to, and cannot fall off', async ({ page }) => {
  await boot(page)

  // At the foot of the stairs, on the ground floor, facing up the flight. The
  // flight climbs towards -Z (north), and a person's yaw of 0 faces that way.
  await page.evaluate(() => window.__app.teleport(4.4, 1.25, 0, 0))
  await page.waitForTimeout(400)
  expect((await page.evaluate(() => window.__app.player())).floor).toBeLessThan(0.15)

  await page.locator('canvas').click({ position: { x: 400, y: 400 } })
  await page.keyboard.down('KeyW')
  try {
    await page.waitForFunction(() => window.__app.room() === 'loft', null, { timeout: 25_000 })
    // …and all the way to the top, rather than stopping part-way up it.
    await page.waitForFunction(() => window.__app.player().floor > 2.3, null, { timeout: 25_000 })
  } finally {
    await page.keyboard.up('KeyW')
  }

  const upstairs = await page.evaluate(() => window.__app.player())
  expect(upstairs.floor).toBeGreaterThan(2.3)
  // Standing on the loft means your eyes are a storey above the great room.
  expect(upstairs.eye).toBeGreaterThan(3.9)

  // Walk at the open side. The balustrade stops you, so the floor never changes.
  await page.evaluate(() => window.__app.teleport(0, 0.4, Math.PI, 2.5))
  await page.waitForTimeout(300)
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(2500)
  await page.keyboard.up('KeyW')

  const after = await page.evaluate(() => window.__app.player())
  expect(after.floor, 'walked off the loft').toBeGreaterThan(2.3)
})

test('a book put down in mid-air falls to the floor instead of hanging there', async ({ page }) => {
  await boot(page)

  // A placement written at chest height — which is what a save file caught
  // mid-throw looks like, and what a drop hands over before the physics has
  // had a frame. Either way it must come down.
  const rest = await page.evaluate(async () => {
    const id = window.__app.boxedBooks()[0]!
    window.__app.putDownForTest(id, { x: 0.6, y: 1.3, z: -0.8, yaw: 0.2, open: false, spread: 0 })
    await new Promise((resolve) => setTimeout(resolve, 3000))
    return window.__app.looseBooks()[id]!
  })

  // Resting on the boards: a book's half-thickness off the floor, not a metre.
  expect(rest.y).toBeLessThan(0.1)
})

test('night falls when asked, and is remembered as a light choice', async ({ page }) => {
  await boot(page)
  expect(await page.evaluate(() => window.__app.night())).toBe(false)
  expect(await page.evaluate(() => window.__app.toggleNightForTest())).toBe(true)
  await expect(page.getByTestId('toggle-night')).toContainText('make it day')
  expect(await page.evaluate(() => window.__app.toggleNightForTest())).toBe(false)
})

test('saving a broken library.json keeps the room you are standing in', async ({ page }) => {
  await boot(page)
  await unpackEverything(page)
  const before = await page.evaluate(() => window.__app.stats())

  const error = await editWorld(page, '"size": [10, 8]', '"size": "enormous"')
  expect(error).toContain('rooms[0].size')

  const after = await page.evaluate(() => window.__app.stats())
  expect(after.rooms).toBe(before.rooms)
  expect(after.shelves).toBe(before.shelves)
  expect(after.shelved).toBe(before.shelved)
  // The rejection did not count as a new document.
  expect(after.worldRevision).toBe(before.worldRevision)
  await expect(page.getByTestId('world-error')).toContainText('rooms[0].size')
})

test('deleting a bookcase moves its books into the boxes, and undoing brings them back', async ({
  page,
}) => {
  await boot(page)
  await unpackEverything(page)
  const boxedBefore = await page.evaluate(() => window.__app.stats().boxed)
  const shelvesBefore = await page.evaluate(() => window.__app.stats().shelves)

  const shelf = 'west-0'
  const before = await page.evaluate(
    (id) => window.__app.rowsOf(id as string, 0),
    shelf,
  )
  expect(before.length).toBeGreaterThan(0)

  // Take the whole bookcase out of the document, exactly as a hand edit would.
  const removed = await editWorld(
    page,
    '{ "id": "west-0", "at": [-4.825, -3.2], "facing": 90, "rows": 5, "label": "Fiction" },',
    '',
  )
  expect(removed).toBeNull()
  await page.waitForTimeout(400)

  const gone = await page.evaluate(() => window.__app.stats())
  expect(gone.shelves).toBe(shelvesBefore - 1)
  expect(gone.boxed).toBeGreaterThan(boxedBefore)
  const boxed = await page.evaluate(() => window.__app.boxedBooks())
  for (const id of before) expect(boxed).toContain(id)
  await expect(page.getByTestId('reconciliation')).toContainText('boxes')

  // The layout on disk still remembers where they belonged...
  const remembered = await page.evaluate(
    (id) => window.__app.savedRowsOf(id as string, 0),
    shelf,
  )
  expect(remembered).toEqual(before)

  // ...so putting the bookcase back puts the books back on it.
  await editWorld(
    page,
    '{ "id": "west-1",',
    '{ "id": "west-0", "at": [-4.825, -3.2], "facing": 90, "rows": 5, "label": "Fiction" }, { "id": "west-1",',
  )
  await page.waitForTimeout(400)

  const restored = await page.evaluate(() => window.__app.stats())
  expect(restored.boxed).toBe(boxedBefore)
  expect(await page.evaluate((id) => window.__app.rowsOf(id as string, 0), shelf)).toEqual(before)
})

test('a book can be taken out of a box and shelved', async ({ page }) => {
  await boot(page)

  const boxed = await page.evaluate(() => window.__app.boxedBooks())
  expect(boxed.length).toBeGreaterThan(0)

  // Look down into a box until the crosshair is on one of the books in it.
  expect(await faceABox(page, 'book'), 'no book in a box was reachable').not.toBeNull()
  const focused = await page.evaluate(() => window.__app.focusedBook())
  expect(focused).not.toBeNull()
  expect(boxed).toContain(focused!.id)

  await page.keyboard.press('KeyE')
  await page.waitForTimeout(400)

  // Assert on what was actually taken, not on what was focused a few round
  // trips ago: in a pile of books lying flat the crosshair can settle on a
  // neighbour between reading it and pressing the key.
  const held = await page.evaluate(() => window.__app.heldBook())
  expect(held, 'nothing was picked up').not.toBeNull()
  expect(boxed, 'the book taken did not come out of a box').toContain(held!.id)
  expect(await page.evaluate(() => window.__app.boxedBooks())).not.toContain(held!.id)

  // And it goes onto a shelf from there, which is the point of the boxes.
  await faceTheShelves(page)
  await settled(page, () => window.__app.shelfTarget() !== null)
  const target = await page.evaluate(() => window.__app.shelfTarget())
  expect(target, 'not aiming at a bookcase').not.toBeNull()

  await page.keyboard.press('KeyE')
  await page.waitForTimeout(400)

  expect(await page.evaluate(() => window.__app.heldBook())).toBeNull()
  const row = await page.evaluate(
    ([shelfId, index]) => window.__app.rowsOf(shelfId as string, index as number),
    [target!.shelfId, target!.row],
  )
  expect(row).toContain(held!.id)
})

/**
 * Stand over a box and look down into it, wherever the map happens to put it.
 *
 * Approached from each side in turn, because a box can be against a wall or
 * behind a chair; the first approach the crosshair actually reaches it from
 * wins. Returns the box id, or null if none could be reached at all.
 */
async function faceABox(page: Page, want: 'box' | 'book' = 'box') {
  const boxes = (await page.evaluate(() => window.__app.places())).boxes
  expect(boxes.length, 'this world has no boxes').toBeGreaterThan(0)

  for (const box of boxes) {
    for (const bearing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      for (const distance of [0.62, 0.8]) {
        await page.evaluate(
          ([box, bearing, distance]) => {
            const b = box as { x: number; z: number; height: number }
            const yaw = bearing as number
            const away = distance as number
            // Stand `away` from the box on this bearing and look back down at
            // it: the pitch is whatever gets the eye onto the top of the pile.
            const x = b.x - Math.sin(yaw) * away
            const z = b.z - Math.cos(yaw) * away
            window.__app.teleport(x, z, yaw)
            window.__app.look(yaw, -Math.atan2(1.68 - b.height * 0.8, away))
          },
          [box, bearing, distance] as const,
        )
        // Wait on the crosshair rather than on the clock — see `settled`.
        const reached = await settled(page, () =>
          Boolean(window.__app.focusedBox() ?? window.__app.boxTarget()),
        )
        if (!reached) continue
        const boxId = await page.evaluate(
          () => window.__app.focusedBox() ?? window.__app.boxTarget(),
        )
        if (!boxId) continue
        // Looking for a book means the crosshair has to be on one, not merely
        // on the cardboard it is lying in.
        if (want === 'book' && (await page.evaluate(() => window.__app.focusedBook())) === null) {
          continue
        }
        return boxId
      }
    }
  }
  return null
}

test('a box can be browsed, so a buried book can be brought to the top', async ({ page }) => {
  await boot(page)

  const boxId = await faceABox(page)
  expect(boxId, 'no box was reachable from any pose').not.toBeNull()

  const view = await page.evaluate((id) => window.__app.boxView(id as string), boxId!)
  expect(view, 'the box reported nothing about what it is showing').not.toBeNull()
  // A box holds far more than it can show — that is what browsing is for.
  expect(view!.total).toBeGreaterThan(view!.shown)
  expect(view!.offset).toBe(0)
  // Whichever card is up: the crosshair may have found the cardboard or a book
  // lying in it, and browsing is offered either way.
  await expect(
    page.getByTestId('box-card').or(page.getByTestId('focus-card')),
  ).toContainText('browse')

  const onTop = await page.evaluate(() => window.__app.visibleInBoxes())
  const contents = await page.evaluate((id) => window.__app.boxContents(id as string), boxId!)
  const buried = contents[view!.shown + 1]!
  expect(onTop).not.toContain(buried)

  // Riffle down one pileful: books that were buried are now the ones on show.
  await page.keyboard.press('BracketRight')
  await page.waitForTimeout(400)

  const after = await page.evaluate((id) => window.__app.boxView(id as string), boxId!)
  expect(after!.offset).toBe(view!.shown)
  expect(await page.evaluate(() => window.__app.visibleInBoxes())).toContain(buried)

  // And back up to the top of the pile again.
  await page.keyboard.press('BracketLeft')
  await page.waitForTimeout(400)
  expect((await page.evaluate((id) => window.__app.boxView(id as string), boxId!))!.offset).toBe(0)
})

test('a book goes back into the box you drop it into, and stays there', async ({ page }) => {
  await boot(page)
  await unpackEverything(page)
  await faceTheShelves(page)

  // Take one off a shelf.
  await page.keyboard.press('KeyE')
  await page.waitForTimeout(400)
  const held = await page.evaluate(() => window.__app.heldBook())
  expect(held, 'nothing was picked up').not.toBeNull()

  // Then stand over a box and look down into it. Holding a book, the crosshair
  // offers the box rather than a shelf behind it.
  const boxId = await faceABox(page)
  expect(boxId, 'no box was reachable from any pose').not.toBeNull()
  expect(await page.evaluate(() => window.__app.boxTarget())).toBe(boxId)
  await expect(page.getByTestId('held-card')).toContainText('drop in the box')

  await page.keyboard.press('KeyE')
  await page.waitForTimeout(400)

  expect(await page.evaluate(() => window.__app.heldBook())).toBeNull()
  expect(await page.evaluate((id) => window.__app.boxContents(id as string), boxId!)).toContain(
    held!.id,
  )

  // Which box it went into is written down, so it is still that box next time.
  await page.waitForTimeout(1200)
  await page.reload()
  await page.waitForFunction(() => window.__app?.ready() === true, null, { timeout: 30_000 })
  expect(await page.evaluate((id) => window.__app.boxContents(id as string), boxId!)).toContain(
    held!.id,
  )
})

test('looking into a box and pressing G unpacks it, and only it', async ({ page }) => {
  await boot(page)

  // Stand over a box. Looking into a full one finds a book — and the book
  // brings its box with it, so the crosshair offers both.
  const boxId = await faceABox(page)
  expect(boxId, 'no box was reachable from any pose').not.toBeNull()
  expect(await page.evaluate(() => window.__app.focusedBox())).toBe(boxId)

  const before = await page.evaluate((id) => window.__app.boxContents(id as string), boxId!)
  const others = await page.evaluate(
    (mine) =>
      window.__app
        .boxIds()
        .filter((id) => id !== mine)
        .map((id) => [id, window.__app.boxContents(id)] as const),
    boxId!,
  )
  expect(before.length).toBeGreaterThan(0)

  await page.keyboard.press('KeyG')
  await page.waitForTimeout(400)

  // That box is empty, the others are untouched, and its books are on shelves.
  expect(await page.evaluate((id) => window.__app.boxContents(id as string), boxId!)).toEqual([])
  expect(
    await page.evaluate(
      (mine) =>
        window.__app
          .boxIds()
          .filter((id) => id !== mine)
          .map((id) => [id, window.__app.boxContents(id)] as const),
      boxId!,
    ),
  ).toEqual(others)

  const stats = await page.evaluate(() => window.__app.stats())
  expect(stats.shelved).toBe(before.length)

  // Spread around the room rather than stacked into the first case by the door.
  const cases = await page.evaluate(() =>
    window.__app
      .places()
      .shelves.filter((shelf) =>
        Array.from({ length: shelf.rows }, (_, row) => row).some(
          (row) => window.__app.rowsOf(shelf.id, row).length > 0,
        ),
      ),
  )
  expect(cases.length).toBeGreaterThan(1)
})

test('you can kneel down to the bottom shelf and stand back up', async ({ page }) => {
  await boot(page)
  // Stand in front of the first case directly rather than through the
  // book-hunting sweep: kneeling is about the eye height, not about finding a
  // book, and on a boxed library the sweep has nothing to find and burns the
  // whole test timeout proving it.
  await page.evaluate(() => {
    const s = window.__app.places().shelves[0]!
    window.__app.teleport(
      s.x + Math.sin(s.rotationY) * 0.85,
      s.z + Math.cos(s.rotationY) * 0.85,
      s.rotationY,
    )
    window.__app.look(s.rotationY, -0.4)
  })
  await page.waitForTimeout(300)
  const standing = await page.evaluate(() => window.__app.player().eye)
  expect(standing).toBeCloseTo(1.68, 2)

  await page.locator('canvas').click({ position: { x: 400, y: 400 } })
  await page.keyboard.down('ControlLeft')
  await page.waitForFunction(() => window.__app.player().crouch > 0.99, null, { timeout: 10_000 })

  const kneeling = await page.evaluate(() => window.__app.player())
  expect(kneeling.eye).toBeLessThan(1.0)
  // Low enough to be level with the bottom compartment, which starts at ~0.1 m.
  expect(kneeling.eye).toBeGreaterThan(0.5)

  await page.keyboard.up('ControlLeft')
  await page.waitForFunction(() => window.__app.player().crouch < 0.01, null, { timeout: 10_000 })
  expect(await page.evaluate(() => window.__app.player().eye)).toBeCloseTo(1.68, 2)
})

test('you can sit in the armchair, read from it, and get up again', async ({ page }) => {
  await boot(page)

  // Stand in front of the chair in the reading corner and look down at it — an
  // armchair is under a metre tall, so a level crosshair sails over the back.
  // Where the chair *is* comes from the world rather than from a coordinate
  // written down here, so rearranging the room does not break this.
  const chair = (await page.evaluate(() => window.__app.furniture())).find(
    (item) => item.id === 'chair',
  )
  expect(chair, 'the reading corner has no armchair called "chair"').toBeDefined()

  let seen: string | null = null
  for (const [away, pitch] of [
    [0.95, -0.62],
    [0.85, -0.75],
    [1.1, -0.5],
    [0.75, -0.9],
  ]) {
    await page.evaluate(
      ([chair, away, pitch]) => {
        const c = chair as { x: number; z: number }
        // Approach from the west, which is the open side of this one.
        window.__app.teleport(c.x - (away as number), c.z, -Math.PI / 2)
        window.__app.look(-Math.PI / 2, pitch as number)
      },
      [chair, away, pitch] as const,
    )
    await page.waitForTimeout(450)
    seen = await page.evaluate(() => window.__app.focusedSeat())
    if (seen === 'chair') break
  }
  expect(seen, 'the armchair was not reachable from any pose').toBe('chair')
  await expect(page.getByTestId('seat-card')).toContainText('sit down')

  await page.keyboard.press('KeyE')
  await page.waitForTimeout(600)

  expect(await page.evaluate(() => window.__app.seat())).toBe('chair')
  await expect(page.getByTestId('seated-card')).toContainText('stand up')

  // Seated: lower than standing, at the chair, and walking does not move you.
  const seated = await page.evaluate(() => window.__app.player())
  expect(seated.eye).toBeLessThan(1.3)
  expect(Math.hypot(seated.x - chair!.x, seated.z - chair!.z)).toBeLessThan(0.4)

  await page.keyboard.down('KeyW')
  await page.waitForTimeout(900)
  await page.keyboard.up('KeyW')
  const after = await page.evaluate(() => window.__app.player())
  expect(Math.hypot(after.x - seated.x, after.z - seated.z)).toBeLessThan(0.01)

  // Standing up puts you back on your feet where the chair is.
  await page.keyboard.press('KeyE')
  await page.waitForTimeout(600)
  expect(await page.evaluate(() => window.__app.seat())).toBeNull()
  await page.waitForFunction(() => window.__app.player().eye > 1.6, null, { timeout: 10_000 })
})

/**
 * Drag across the page from `fromFraction` to `toFraction` of the viewport.
 *
 * Keep `fromFraction` off the right-hand edge: the panel is a real bit of UI
 * sitting over the canvas there, and a pointer down on it is a click on the
 * panel, not a grab of the page. The book fills the middle of the screen.
 */
async function dragPage(page: Page, fromFraction: number, toFraction: number, steps = 12) {
  const box = (await page.locator('canvas').boundingBox())!
  const y = box.y + box.height * 0.5
  const at = (f: number) => box.x + box.width * f

  await page.mouse.move(at(fromFraction), y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    const f = fromFraction + ((toFraction - fromFraction) * i) / steps
    await page.mouse.move(at(f), y)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
}

test('a page can be dragged across, and half a drag is only a peek', async ({ page }) => {
  // Three full turns, each animated, with the whole cabin and the forest behind
  // the book being redrawn every frame by a software rasteriser. It is not that
  // anything is slow — it is that this drives more of the app end to end than
  // anything else here, and the default minute is not enough room for it.
  test.slow()
  await boot(page)
  const opened = await page.evaluate(() => window.__app.readForTest('sample-book'))
  expect(opened.failure).toBeNull()
  expect(opened.spread).toBe(0)

  // A short drag from the right-hand page: lifted, then dropped back.
  await dragPage(page, 0.72, 0.62)
  await page.waitForFunction(() => window.__app.reader().turning === false, null, {
    timeout: 15_000,
  })
  expect(
    await page.evaluate(() => window.__app.reader().spread),
    'a peek should not turn the page',
  ).toBe(0)

  // Carried most of the way across, it goes.
  await dragPage(page, 0.72, 0.24)
  await page.waitForFunction(() => window.__app.reader().spread === 1, null, { timeout: 20_000 })
  expect(await page.evaluate(() => window.__app.reader().showing)).toEqual([2, 3])

  // And dragging from the left-hand side takes you back.
  await dragPage(page, 0.22, 0.76)
  await page.waitForFunction(() => window.__app.reader().spread === 0, null, { timeout: 20_000 })
})

test('the leaf follows the pointer rather than a clock', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => window.__app.readForTest('sample-book'))

  const box = (await page.locator('canvas').boundingBox())!
  const y = box.y + box.height * 0.5
  await page.mouse.move(box.x + box.width * 0.72, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.62, y)
  await page.waitForTimeout(300)

  // Held still mid-drag, the leaf must stay where it was put. A scripted
  // animation would have carried on and completed the turn by now.
  const held = await page.evaluate(() => window.__app.reader())
  expect(held.turning).toBe(true)
  expect(held.progress).toBeGreaterThan(0.1)
  expect(held.progress).toBeLessThan(0.9)

  await page.waitForTimeout(700)
  const later = await page.evaluate(() => window.__app.reader())
  expect(later.progress).toBeCloseTo(held.progress, 3)
  expect(later.spread).toBe(0)

  await page.mouse.up()
})

test('a bookmark is set, survives a reload, and takes you back to its page', async ({ page }) => {
  test.slow()
  await boot(page)
  await page.evaluate(() => window.__app.readForTest('sample-book'))

  // Get to a spread worth marking.
  await dragPage(page, 0.72, 0.24)
  await page.waitForFunction(() => window.__app.reader().spread === 1, null, { timeout: 20_000 })

  await page.keyboard.press('KeyB')
  await page.waitForTimeout(200)
  expect(await page.evaluate(() => window.__app.bookmarksOf('sample-book'))).toEqual([1])

  // Pressing it again takes the bookmark out, as a slip of paper would.
  await page.keyboard.press('KeyB')
  await page.waitForTimeout(200)
  expect(await page.evaluate(() => window.__app.bookmarksOf('sample-book'))).toEqual([])

  await page.keyboard.press('KeyB')
  // The layout save is debounced; give it time to land before reloading.
  await page.waitForTimeout(1200)

  await page.reload()
  await page.waitForFunction(() => window.__app?.ready() === true, null, { timeout: 30_000 })
  expect(await page.evaluate(() => window.__app.bookmarksOf('sample-book'))).toEqual([1])

  // Open the book again: it starts at the front, and the ribbon gets you back.
  await page.evaluate(() => window.__app.readForTest('sample-book'))
  expect(await page.evaluate(() => window.__app.reader().spread)).toBe(0)
})

test('spines are printed for the shelf you are at, and only for that shelf', async ({ page }) => {
  // Waiting for the atlas to stop moving means waiting several printing passes,
  // and a pass only runs every few frames — so this is bounded by the frame rate
  // twice over, once at each shelf. The default minute is not enough room.
  test.slow()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await boot(page)
  await unpackEverything(page)
  await faceTheShelves(page)

  /**
   * Printing is spread over several passes so a turn on the spot cannot stall a
   * frame, which means "how much is printed" is a function of frames elapsed,
   * not of wall clock — and headless runs at a few frames a second. So wait for
   * the count to stop moving rather than for a duration.
   */
  const settle = async () => {
    await page.evaluate(() => {
      const w = window as unknown as { __spines?: string; __stable?: number }
      w.__spines = undefined
      w.__stable = 0
    })
    await page.waitForFunction(
      () => {
        const w = window as unknown as { __spines?: string; __stable?: number }
        const spines = window.__app.spines()
        // Both counters, not just one. `reprinted` can sit still for a moment
        // between passes while `printed` is still climbing, and calling that
        // settled is how this used to decide the atlas was full at a third of
        // what it eventually holds.
        const now = `${spines.printed}:${spines.reprinted}`
        w.__stable = w.__spines === now ? (w.__stable ?? 0) + 1 : 0
        w.__spines = now
        // Several passes' worth of no change: a pass only runs every few frames,
        // and headless frames are slow enough that two samples can straddle one.
        return (w.__stable ?? 0) >= 5
      },
      null,
      { timeout: 90_000, polling: 1500 },
    )
  }

  await settle()
  const near = await page.evaluate(() => window.__app.spines())
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
  expect(near.printed, 'nothing printed while standing at a shelf').toBeGreaterThan(60)
  // The atlas is a fixed size on purpose; printing must never exceed it.
  expect(near.printed).toBeLessThanOrEqual(near.slots)

  // Every book in the library is still one draw call, which is the whole point
  // of an atlas rather than a text mesh per spine. The ceiling is deliberately
  // loose, because it is not the books that set it: the cabin is a few hundred
  // boxes and cylinders of furniture, and that is what the number tracks. What
  // it rules out is a shelved book costing anything at all — see the test below
  // it, which is the one that actually guards that.
  const stats = await page.evaluate(() => window.__app.stats())
  expect(stats.drawCalls).toBeLessThan(600)

  // Standing still costs nothing: no cell changes hands.
  const settled = near.reprinted
  await page.waitForTimeout(900)
  expect(await page.evaluate(() => window.__app.spines().reprinted)).toBe(settled)

  // Move to another room with bookcases in it and the cells are recycled onto
  // what is in front of you now, rather than the atlas filling up and giving
  // out. Somewhere with no books would prove nothing: no cell would be drawn.
  await page.evaluate(() => window.__app.teleport(-7.44, 0.9, 0))
  await settle()
  const moved = await page.evaluate(() => window.__app.spines())
  expect(moved.reprinted).toBeGreaterThan(settled)
  expect(moved.printed).toBeLessThanOrEqual(moved.slots)
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
})

test('shelving the whole library costs nothing to draw', async ({ page }) => {
  await boot(page)
  await page.waitForTimeout(1500)
  const boxed = await page.evaluate(() => window.__app.stats())

  await unpackEverything(page)
  await page.waitForTimeout(1500)
  const shelved = await page.evaluate(() => window.__app.stats())

  expect(shelved.shelved).toBeGreaterThan(100)
  expect(boxed.shelved).toBe(0)
  /**
   * Seventeen hundred books just moved out of the boxes and onto the shelves,
   * from one instanced mesh into another, without the camera moving. The frame
   * should therefore cost the same either way.
   *
   * This is the assertion that actually guards the atlas. A hard ceiling on
   * draw calls tracks how much furniture is in the room, which is a decision
   * about the map; this tracks whether a book costs anything, which is a
   * decision about the renderer — and if it ever fails by hundreds, something
   * has started drawing books one at a time.
   */
  expect(Math.abs(shelved.drawCalls - boxed.drawCalls)).toBeLessThan(20)
})

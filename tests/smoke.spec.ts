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
      room: () => string | null
      worldText: () => string | null
      editWorld: (text: string) => Promise<string | null>
      teleport: (x: number, z: number, yaw?: number) => void
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

/** The moving boxes the default document puts on the floor of the main room. */
const BOXES = ['box-1', 'box-2', 'box-3', 'box-4']

/**
 * Unpack every box onto the shelves.
 *
 * A newly indexed library arrives boxed and stays that way until you unpack it,
 * so most of what follows — taking a book off a shelf, printing spines, losing
 * a bookcase — starts by doing what you would do first in the room.
 */
async function unpackEverything(page: Page) {
  const shelved = await page.evaluate(
    (boxes) => boxes.reduce((total, id) => total + window.__app.emptyBoxForTest(id), 0),
    BOXES,
  )
  expect(shelved, 'nothing came out of the boxes').toBeGreaterThan(100)
  await page.waitForTimeout(300)
  return shelved
}

/** Stand in front of the left-hand bookcases, looking at them. */
async function faceTheShelves(page: Page) {
  await page.evaluate(() => {
    window.__app.teleport(-1.9, 0.6, Math.PI / 2 + 0.35)
    window.__app.look(Math.PI / 2 + 0.35, -0.1)
  })
  await page.waitForTimeout(500)
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
  await page.keyboard.press('KeyE')
  await page.waitForTimeout(300)
  const target = await page.evaluate(() => window.__app.shelfTarget())
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

test('the library opens in two rooms you can walk between', async ({ page }) => {
  await boot(page)

  const stats = await page.evaluate(() => window.__app.stats())
  expect(stats.rooms).toBe(2)
  expect(stats.worldError).toBeNull()
  expect(await page.evaluate(() => window.__app.room())).toBe('main')

  // Through the doorway on the east wall and into the reading corner. Walking
  // is timed in simulation steps, and headless runs well under the 20 fps the
  // movement delta is clamped at, so this waits on arrival rather than on a
  // duration that would only be right on this machine.
  await page.evaluate(() => window.__app.teleport(3.0, 0, -Math.PI / 2))
  await page.locator('canvas').click({ position: { x: 400, y: 400 } })
  await page.keyboard.down('KeyW')
  try {
    await page.waitForFunction(() => window.__app.room() === 'reading', null, { timeout: 25_000 })
  } finally {
    await page.keyboard.up('KeyW')
  }

  expect(await page.evaluate(() => window.__app.room())).toBe('reading')
})

test('saving a broken library.json keeps the room you are standing in', async ({ page }) => {
  await boot(page)
  await unpackEverything(page)
  const before = await page.evaluate(() => window.__app.stats())

  const error = await editWorld(page, '"size": [8, 6]', '"size": "enormous"')
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

  const shelf = 'west-0'
  const before = await page.evaluate(
    (id) => window.__app.rowsOf(id as string, 0),
    shelf,
  )
  expect(before.length).toBeGreaterThan(0)

  // Take the whole bookcase out of the document, exactly as a hand edit would.
  const removed = await editWorld(
    page,
    '{ "id": "west-0", "at": [-3.835, -1.9], "facing": 90, "rows": 5 },',
    '',
  )
  expect(removed).toBeNull()
  await page.waitForTimeout(400)

  const gone = await page.evaluate(() => window.__app.stats())
  expect(gone.shelves).toBe(13 + 4 - 1)
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
    '{ "id": "west-0", "at": [-3.835, -1.9], "facing": 90, "rows": 5 }, { "id": "west-1",',
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

  // Stand at the boxes along the south wall and look down into them. Sweep a
  // few poses rather than hard-coding one: the point of the test is that the
  // pile is reachable, not that a particular pitch happens to hit it.
  let focused: { id: string } | null = null
  for (const [x, z, pitch] of [
    [-2.1, 1.35, -0.8],
    [-2.1, 1.35, -0.95],
    [-1.4, 1.5, -0.85],
    [-2.7, 1.5, -0.85],
  ]) {
    await page.evaluate(
      ([x, z, pitch]) => {
        window.__app.teleport(x as number, z as number, Math.PI)
        window.__app.look(Math.PI, pitch as number)
      },
      [x, z, pitch],
    )
    await page.waitForTimeout(350)
    focused = await page.evaluate(() => window.__app.focusedBook())
    if (focused && (await page.evaluate(() => window.__app.boxedBooks())).includes(focused.id)) {
      break
    }
    focused = null
  }

  expect(focused, 'no book in the boxes was reachable from any pose').not.toBeNull()
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

test('a book goes back into the box you drop it into, and stays there', async ({ page }) => {
  await boot(page)
  await unpackEverything(page)
  await faceTheShelves(page)

  // Take one off a shelf.
  await page.keyboard.press('KeyE')
  await page.waitForTimeout(400)
  const held = await page.evaluate(() => window.__app.heldBook())
  expect(held, 'nothing was picked up').not.toBeNull()

  // Then stand over the boxes and look down into them. Holding a book, the
  // crosshair offers the box rather than a shelf behind it.
  let boxId: string | null = null
  for (const [x, z, pitch] of [
    [-2.1, 1.35, -0.8],
    [-2.1, 1.35, -0.95],
    [-1.4, 1.5, -0.85],
    [-2.7, 1.5, -0.85],
  ]) {
    await page.evaluate(
      ([x, z, pitch]) => {
        window.__app.teleport(x as number, z as number, Math.PI)
        window.__app.look(Math.PI, pitch as number)
      },
      [x, z, pitch],
    )
    await page.waitForTimeout(350)
    boxId = await page.evaluate(() => window.__app.boxTarget())
    if (boxId) break
  }
  expect(boxId, 'no box was reachable from any pose').not.toBeNull()
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

test('emptying one box shelves its books and leaves the others alone', async ({ page }) => {
  await boot(page)

  const before = await page.evaluate((id) => window.__app.boxContents(id as string), BOXES[0]!)
  const others = await page.evaluate(
    (boxes) => (boxes as string[]).slice(1).map((id) => window.__app.boxContents(id)),
    BOXES,
  )
  expect(before.length).toBeGreaterThan(0)

  const shelved = await page.evaluate(
    (id) => window.__app.emptyBoxForTest(id as string),
    BOXES[0]!,
  )
  expect(shelved).toBe(before.length)
  await page.waitForTimeout(300)

  // That box is empty, the others are untouched, and its books are on shelves.
  expect(await page.evaluate((id) => window.__app.boxContents(id as string), BOXES[0]!)).toEqual([])
  expect(
    await page.evaluate(
      (boxes) => (boxes as string[]).slice(1).map((id) => window.__app.boxContents(id)),
      BOXES,
    ),
  ).toEqual(others)

  const stats = await page.evaluate(() => window.__app.stats())
  expect(stats.shelved).toBe(before.length)

  // Spread around the room rather than stacked into the first case by the door.
  const cases = await page.evaluate(
    (ids) =>
      (ids as string[]).filter((shelfId) =>
        [0, 1, 2, 3, 4].some((row) => window.__app.rowsOf(shelfId, row).length > 0),
      ),
    ['west-0', 'west-4', 'east-0', 'north-3', 'reading-n0', 'reading-s1'],
  )
  expect(cases.length).toBeGreaterThan(1)
})

test('you can kneel down to the bottom shelf and stand back up', async ({ page }) => {
  await boot(page)
  await faceTheShelves(page)
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
  await page.evaluate(() => {
    window.__app.teleport(7.0, 0.25, -Math.PI / 2)
    window.__app.look(-Math.PI / 2, -0.62)
  })
  await page.waitForTimeout(600)
  expect(await page.evaluate(() => window.__app.focusedSeat())).toBe('chair')
  await expect(page.getByTestId('seat-card')).toContainText('sit down')

  await page.keyboard.press('KeyE')
  await page.waitForTimeout(600)

  expect(await page.evaluate(() => window.__app.seat())).toBe('chair')
  await expect(page.getByTestId('seated-card')).toContainText('stand up')

  // Seated: lower than standing, at the chair, and walking does not move you.
  const seated = await page.evaluate(() => window.__app.player())
  expect(seated.eye).toBeLessThan(1.3)
  expect(Math.hypot(seated.x - 8.29, seated.z - 0.25)).toBeLessThan(0.4)

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

/** Drag across the page from `fromFraction` to `toFraction` of the viewport. */
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
  await dragPage(page, 0.78, 0.24)
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
  await page.mouse.move(box.x + box.width * 0.78, y)
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
  await boot(page)
  await page.evaluate(() => window.__app.readForTest('sample-book'))

  // Get to a spread worth marking.
  await dragPage(page, 0.78, 0.24)
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
      const w = window as unknown as { __spines?: number; __stable?: number }
      w.__spines = undefined
      w.__stable = 0
    })
    await page.waitForFunction(
      () => {
        const w = window as unknown as { __spines?: number; __stable?: number }
        const now = window.__app.spines().reprinted
        w.__stable = w.__spines === now ? (w.__stable ?? 0) + 1 : 0
        w.__spines = now
        // Several passes' worth of no change: a pass only runs every few frames,
        // and headless frames are slow enough that two samples can straddle one.
        return (w.__stable ?? 0) >= 4
      },
      null,
      { timeout: 90_000, polling: 1200 },
    )
  }

  await settle()
  const near = await page.evaluate(() => window.__app.spines())
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
  expect(near.printed, 'nothing printed while standing at a shelf').toBeGreaterThan(60)
  // The atlas is a fixed size on purpose; printing must never exceed it.
  expect(near.printed).toBeLessThanOrEqual(near.slots)

  // Every book in the library is still one draw call, which is the whole point
  // of an atlas rather than a text mesh per spine.
  const stats = await page.evaluate(() => window.__app.stats())
  expect(stats.drawCalls).toBeLessThan(120)

  // Standing still costs nothing: no cell changes hands.
  const settled = near.reprinted
  await page.waitForTimeout(900)
  expect(await page.evaluate(() => window.__app.spines().reprinted)).toBe(settled)

  // Move to another room and the cells are recycled onto what is in front of
  // you now, rather than the atlas filling up and giving out.
  await page.evaluate(() => window.__app.teleport(7.4, 1.4, Math.PI))
  await settle()
  const moved = await page.evaluate(() => window.__app.spines())
  expect(moved.reprinted).toBeGreaterThan(settled)
  expect(moved.printed).toBeLessThanOrEqual(moved.slots)
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
})

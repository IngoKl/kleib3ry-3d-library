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
  /** `stats()` spreads the whole app store; these are the slots tests read. */
  focusedFixture: string | null
  focusedTape: string | null
  heldTape: string | null
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
        /** 0 standing, 1 fully zoomed, and the field of view that produces. */
        zoom: number
        fov: number
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
      shelveForTest: (id: string, shelfId: string, row: number, index?: number) => boolean
      night: () => boolean
      toggleNightForTest: () => boolean
      raining: () => boolean
      toggleRainForTest: () => boolean
      cat: () => {
        x: number
        z: number
        floor: number
        mood: string
        purr: number
        carrying: string | null
      }
      startForTest: () => void
      callCatForTest: () => boolean
      petCatForTest: () => void
      fetchBookForTest: () => boolean
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
      tapes: () => string[]
      focusedTape: () => string | null
      heldTape: () => string | null
      nowWatching: () => { playing: string | null; error: string | null }
      pins: () => {
        id: string
        kind: 'page' | 'note'
        bookId?: string
        page?: number
        text?: string
        x: number
        y: number
        z: number
      }[]
      heldPin: () => { kind: 'page' | 'note'; page?: number; text?: string } | null
      pinTarget: () => { x: number; y: number; z: number; yaw: number } | null
      focusedPin: () => string | null
      /** Where each whiteboard is drawn, measured off its meshes. */
      boards: () => { id: string; bottom: number; top: number }[]
      reader: () => ReaderStatus
      readForTest: (id: string) => Promise<ReaderStatus>
      setModeForTest: (mode: string) => void
      bookmarksOf: (id: string) => number[]
      spines: () => { printed: number; slots: number; reprinted: number }
    }
  }
}

/**
 * Load the app and go in.
 *
 * The room now loads *behind* a main menu rather than in front of nothing, so
 * every test starts by pressing the button somebody would press. Nothing
 * reaches the room until it has been — that is the whole point of the gate —
 * so a test that skipped this would find every key dead.
 */
async function boot(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => window.__app?.ready() === true, null, { timeout: 30_000 })
  await page.getByTestId('enter-library').click()
  await expect(page.getByTestId('main-menu')).toHaveCount(0)
}

/** The same, after a reload: the menu comes back with the page. */
async function reboot(page: Page) {
  await page.reload()
  await page.waitForFunction(() => window.__app?.ready() === true, null, { timeout: 30_000 })
  await page.getByTestId('enter-library').click()
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
  const deadline = Date.now() + timeout
  do {
    // Asked from *this* side rather than with `waitForFunction`, which schedules
    // its poll as a page timer. Under the load this helper exists to tolerate
    // those timers are starved, so a condition that became true was reported as
    // never having happened — which reads as the room being wrong, and sends the
    // sweep on to try another twenty-nine poses for no reason.
    if (await page.evaluate(condition)) return true
    await page.waitForTimeout(50)
  } while (Date.now() < deadline)
  return false
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

  /**
   * Alive and rendering — and *only* that, which is why it is a wait rather than
   * a reading.
   *
   * This runs on SwiftShader, a software rasteriser, where the printed spines
   * cost a texture fetch per fragment across a thousand-odd boxes: free on a GPU,
   * expensive here. Counting frames inside a fixed 2 s window therefore measured
   * the host's spare capacity, not the app — the same 8-frame bar read 13 on an
   * idle machine and exactly 8 on a busy one, and a test that flips on whether
   * something else is compiling is a test nobody can act on.
   *
   * So: wait until enough frames have gone by, with an allowance long enough that
   * only a *stopped* render loop can fail it. Which is what the assertion was
   * ever for; the threshold was 30 when books were flat colours, and every
   * lowering of it since has been this discovery arriving late.
   */
  const enoughFrames = 9
  await page.waitForFunction(
    (want) => window.__app.stats().frames >= want,
    enoughFrames,
    { timeout: 60_000, polling: 500 },
  )

  const stats = await page.evaluate(() => window.__app.stats())

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
  expect(stats.rootLoaded).toBe(true)
  expect(stats.mode).toBe('walk')
  expect(stats.driver).toBe('browser')
  expect(stats.libraryError).toBeNull()

  expect(stats.drawCalls).toBeGreaterThan(5)
  expect(stats.triangles).toBeGreaterThan(1000)
  expect(stats.frames).toBeGreaterThanOrEqual(enoughFrames)

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

/**
 * Walking is measured in *frames*, not in milliseconds.
 *
 * The controller caps its own step at 1/20 s so that a dropped frame cannot
 * teleport anybody through a wall, which means distance covered is bounded by
 * frames rendered — and one frame here is however long a software rasteriser
 * takes over the whole cabin, on a machine that has other things to do. Holding
 * `W` for a fixed 1200 ms therefore tests the host's spare capacity rather than
 * the walk controller: the same code covers 1.9 m on an idle machine and 5 cm on
 * a busy one.
 *
 * So: hold the key until the thing being tested has happened, or give up. Same
 * property, and the failure now means "walking does not work" rather than "this
 * machine was busy" — which is the distinction `settled()` above draws for the
 * crosshair, for exactly the same reason.
 *
 * The budgets are minutes, not seconds, and were raised again when the building
 * grew a second storey's worth of rooms. Distance covered is bounded by frames
 * rendered; frames rendered is bounded by how much room there is to draw and how
 * busy the host is. A generous budget still catches a stopped walk controller —
 * which is the only thing it is for — while a tight one just reports the weather.
 */
async function walkUntil(page: Page, reached: (z: number) => boolean, budgetMs = 60_000) {
  await page.keyboard.down('KeyW')
  const deadline = Date.now() + budgetMs
  try {
    while (Date.now() < deadline) {
      // Asked from *this* side rather than with `waitForFunction`, which schedules
      // its poll as a page timer: when the page is saturated those timers are
      // starved, and a walk that plainly happened reports as never having
      // started because nothing sampled it while it was going on.
      if (reached(await page.evaluate(() => window.__app.player().z))) return true
      await page.waitForTimeout(250)
    }
    return false
  } finally {
    await page.keyboard.up('KeyW')
    // One more frame's worth of easing, so a reading taken now is settled.
    await page.waitForTimeout(200)
  }
}

test('walking moves the player and walls stop them', async ({ page }) => {
  await boot(page)

  const start = await page.evaluate(() => {
    window.__app.teleport(0, 1.5, Math.PI)
    return window.__app.player()
  })

  await page.locator('canvas').click({ position: { x: 400, y: 400 } })

  const moved = await walkUntil(page, (z) => z > start.z + 0.3, 60_000)
  const after = await page.evaluate(() => window.__app.player())
  expect(moved, `walking got nowhere: z went ${start.z} -> ${after.z}`).toBe(true)
  expect(after.z).toBeGreaterThan(start.z + 0.3)

  // And now the other half: keep going, and stop being carried. Something in
  // the room ahead — the moving boxes, then the south wall — refuses the step,
  // so this waits for a *failure* to move and asserts where it happened.
  const wall = await page.evaluate(() => window.__app.player().z)
  await walkUntil(page, (z) => z > 3, 30_000)
  const stopped = await page.evaluate(() => window.__app.player().z)
  expect(stopped, 'never even reached the far side of the room').toBeGreaterThanOrEqual(wall)
  expect(stopped, 'walked through something solid').toBeLessThan(3)
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

  await reboot(page)

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
  // The library folder and the scan moved into settings when the HUD was cut
  // back to what is under the crosshair and what is going wrong. The count
  // stayed out here, because a library still in its boxes is the second.
  await expect(page.getByTestId('book-count')).toContainText('books')

  await page.getByTestId('open-settings').click()
  await expect(page.getByTestId('settings-card')).toBeVisible()
  await expect(page.getByRole('button', { name: /choose folder/i })).toBeDisabled()
  await expect(page.getByRole('button', { name: /^scan$/i })).toBeDisabled()
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
  // The great room, the loft inside it, the reading corner, the bedroom over
  // that, the kitchen, the office off the kitchen, the porch — and the lake
  // house and its deck, a trail away across the site.
  expect(stats.rooms).toBe(9)
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
    await page.waitForFunction(() => window.__app.room() === 'reading', null, { timeout: 90_000 })
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
    await page.waitForFunction(() => window.__app.room() === 'loft', null, { timeout: 90_000 })
    // …and all the way to the top, rather than stopping part-way up it.
    await page.waitForFunction(() => window.__app.player().floor > 2.3, null, { timeout: 90_000 })
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
  const dropped = await page.evaluate(() => {
    const id = window.__app.boxedBooks()[0]!
    window.__app.putDownForTest(id, { x: 0.6, y: 1.3, z: -0.8, yaw: 0.2, open: false, spread: 0 })
    ;(window as unknown as { __falling: string }).__falling = id
    return id
  })

  /**
   * Waited for, not slept through.
   *
   * Falling is simulated per *frame* with the step clamped at 1/20 s, so how far
   * a book has fallen after three seconds is a fact about the host's spare
   * capacity — on the software rasteriser these tests run on that can be three
   * frames. The same argument every other wait in this file makes.
   */
  const landed = await settled(
    page,
    () => {
      const id = (window as unknown as { __falling: string }).__falling
      const at = window.__app.looseBooks()[id]
      return at !== undefined && at.y < 0.1
    },
    60_000,
  )

  // Resting on the boards: a book's half-thickness off the floor, not a metre.
  const rest = await page.evaluate((id) => window.__app.looseBooks()[id as string]!, dropped)
  expect(landed, `it hung in the air at ${rest.y.toFixed(2)} m`).toBe(true)
  expect(rest.y).toBeLessThan(0.1)
})

test('night falls when asked, and is remembered as a light choice', async ({ page }) => {
  await boot(page)
  expect(await page.evaluate(() => window.__app.night())).toBe(false)
  expect(await page.evaluate(() => window.__app.toggleNightForTest())).toBe(true)

  // The switch lives in settings now, and reflects what the room actually did
  // rather than being the only way to do it — `N` is still the way in the room.
  await page.getByTestId('open-settings').click()
  await expect(page.getByTestId('toggle-night')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('toggle-night').click()
  expect(await page.evaluate(() => window.__app.night())).toBe(false)
})

test('it rains when asked, and the weather is saved with the lamps', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await boot(page)
  expect(await page.evaluate(() => window.__app.raining())).toBe(false)

  await page.keyboard.press('KeyK')
  expect(await settled(page, () => window.__app.raining() === true, 5000)).toBe(true)

  // Rain is seven hundred instanced streaks and a wet plane on every glazed
  // opening the document derives, so a map with an unusual window is the way
  // this breaks — and it would break as a console error, not as a wrong number.
  await page.waitForTimeout(1500)
  expect(errors, `console errors while raining: ${errors.join(' | ')}`).toEqual([])

  // Rain is a fact about the room, not a setting about the app, so it is saved
  // beside the lamps and comes back with them.
  await page.waitForTimeout(800)
  await reboot(page)
  expect(await page.evaluate(() => window.__app.raining())).toBe(true)

  await page.keyboard.press('KeyK')
  expect(await settled(page, () => window.__app.raining() === false, 5000)).toBe(true)
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
  /**
   * Make sure the case under test actually has books on it.
   *
   * Unpacking fills *empty* rows in a shuffled order and stops when the boxes
   * run out, so with more shelves in the building than there are books to fill
   * them, whether any particular row is stocked is not something to assume — and
   * a test that assumed it fails the day somebody adds a bookcase.
   */
  const before = await page.evaluate((id) => {
    const app = window.__app
    const want = id as string
    if (app.rowsOf(want, 0).length === 0) {
      // Off another case rather than out of a box: unpacking fills rows to
      // capacity one at a time, so with more shelf than library the boxes come
      // out *empty* and about half the rows never get anything.
      const spare: string[] = []
      for (const unit of app.places().shelves) {
        if (unit.id === want) continue
        for (let row = 0; row < unit.rows && spare.length < 4; row++) {
          spare.push(...app.rowsOf(unit.id, row).slice(0, 4 - spare.length))
        }
        if (spare.length >= 4) break
      }
      for (const book of spare) app.shelveForTest(book, want, 0)
    }
    return app.rowsOf(want, 0)
  }, shelf)
  expect(before.length).toBeGreaterThan(0)

  // Take the whole bookcase out of the document, exactly as a hand edit would.
  const removed = await editWorld(
    page,
    '{ "id": "west-0", "at": [-4.825, -3.2], "facing": 90, "rows": 5 },',
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
    '{ "id": "west-0", "at": [-4.825, -3.2], "facing": 90, "rows": 5 }, { "id": "west-1",',
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
  await reboot(page)
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
  /**
   * Eye height is *eased*, so how close it is to standing after a fixed sleep is
   * a fact about the frame rate rather than about the controller. Waited for,
   * like everything else here.
   */
  await page.waitForFunction(() => Math.abs(window.__app.player().eye - 1.68) < 0.004, null, {
    timeout: 20_000,
  })

  await page.locator('canvas').click({ position: { x: 400, y: 400 } })
  await page.keyboard.down('ControlLeft')
  await page.waitForFunction(() => window.__app.player().crouch > 0.99, null, { timeout: 20_000 })
  // The crouch reaching 1 is the *input* arriving; the eye follows it down.
  await page.waitForFunction(() => window.__app.player().eye < 1.0, null, { timeout: 20_000 })

  const kneeling = await page.evaluate(() => window.__app.player())
  expect(kneeling.eye).toBeLessThan(1.0)
  // Low enough to be level with the bottom compartment, which starts at ~0.1 m.
  expect(kneeling.eye).toBeGreaterThan(0.5)

  await page.keyboard.up('ControlLeft')
  await page.waitForFunction(() => window.__app.player().crouch < 0.01, null, { timeout: 20_000 })
  await page.waitForFunction(() => Math.abs(window.__app.player().eye - 1.68) < 0.004, null, {
    timeout: 20_000,
  })
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
  // Sitting down *eases* you into the chair, so the reading is taken once that
  // has finished rather than at a fixed moment part-way through it — otherwise
  // what the walk is measured against is a position still on its way.
  await page.waitForFunction(() => window.__app.player().eye < 1.3, null, { timeout: 20_000 })
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __seat?: string }
      const p = window.__app.player()
      const now = `${p.x.toFixed(4)}:${p.z.toFixed(4)}`
      const still = w.__seat === now
      w.__seat = now
      return still
    },
    null,
    { timeout: 20_000, polling: 400 },
  )

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

  await reboot(page)
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

// --- what has been added since the room was first walkable ------------------

test('the view zooms while the key is held, and opens back out', async ({ page }) => {
  await boot(page)

  const wide = await page.evaluate(() => window.__app.player().fov)
  expect(wide, 'the walking field of view').toBeGreaterThan(60)

  await page.keyboard.down('KeyZ')
  const narrowed = await settled(page, () => window.__app.player().fov < 40, 20_000)
  const zoomed = await page.evaluate(() => window.__app.player())
  await page.keyboard.up('KeyZ')

  expect(narrowed, `field of view went ${wide} -> ${zoomed.fov}`).toBe(true)
  expect(zoomed.zoom).toBeGreaterThan(0.5)

  // Held, not toggled: letting go opens the view back out on its own.
  const opened = await settled(page, () => window.__app.player().fov > 60, 20_000)
  expect(opened, 'the view stayed narrowed after the key came up').toBe(true)
})

/**
 * Stand in the loft and find the tape crate, or the television.
 *
 * Derived from the world rather than written down, like `faceTheShelves`: the
 * default map is a document somebody edits, and a test that knows where the
 * television *was* fails the day it is moved. So this asks where the piece is,
 * stands a stride back from it, and sweeps until the crosshair reports.
 */
async function facePiece(page: Page, kind: string, found: () => boolean) {
  const pieces = await page.evaluate(
    (want: string) => window.__app.furniture().filter((item) => item.kind === want),
    kind,
  )
  expect(pieces.length, `this world has no ${kind}`).toBeGreaterThan(0)

  for (const piece of pieces) {
    for (const back of [0.7, 1.0, 1.35]) {
      for (const pitch of [-0.5, -0.75, -0.3, -0.95]) {
        // A stride to the south of it, looking north and down into it: the loft's
        // den faces the balustrade, so this is the side you would stand on.
        await page.evaluate(
          ([x, z, floor]) => window.__app.teleport(x!, z!, Math.PI, floor!),
          [piece.x, piece.z + back, piece.y],
        )
        await page.evaluate((p) => window.__app.look(Math.PI, p), pitch)
        if (await settled(page, found, 3000)) return true
      }
    }
  }
  return false
}

test('a tape comes out of the crate and goes into the television', async ({ page }) => {
  await boot(page)

  const tapes = await page.evaluate(() => window.__app.tapes())
  expect(tapes.length, 'nothing in video/').toBeGreaterThan(0)

  const atCrate = await facePiece(page, 'tapecrate', () => window.__app.focusedTape() !== null)
  expect(atCrate, 'never found a tape in the crate').toBe(true)

  await page.keyboard.press('KeyE')
  const held = await settled(page, () => window.__app.heldTape() !== null, 5000)
  expect(held, 'E did not take the tape out').toBe(true)
  await expect(page.getByTestId('held-tape-card')).toBeVisible()

  // Now the set. With a tape in hand nothing else is on offer, so the crosshair
  // reporting a fixture at all means the television.
  const atSet = await facePiece(page, 'crt', () => window.__app.stats().focusedFixture !== null)
  expect(atSet, 'never found the television').toBe(true)

  await page.keyboard.press('KeyE')
  const inTheMachine = await settled(page, () => window.__app.heldTape() === null, 5000)
  expect(inTheMachine, 'E did not put the tape in').toBe(true)

  /**
   * And it says what happened.
   *
   * The placeholder tapes point at nothing, so playback *fails* — which is the
   * interesting case, and the same one a real container the WebView cannot decode
   * produces. What must not happen is silence: the tape leaves your hand either
   * way, so a failure nobody reports is a television that ate your cassette.
   */
  const reported = await settled(
    page,
    () => window.__app.nowWatching().error !== null || window.__app.nowWatching().playing !== null,
    10_000,
  )
  const watching = await page.evaluate(() => window.__app.nowWatching())
  expect(reported, `neither playing nor complaining: ${JSON.stringify(watching)}`).toBe(true)
})

test('a page torn out of a book pins to a wall, and the book keeps its own', async ({ page }) => {
  await boot(page)

  const opened = await page.evaluate(() => window.__app.readForTest('sample-book'))
  expect(opened.rendered, `the book never rendered: ${opened.failure ?? ''}`).toBe(true)

  // `P` copies the page you are looking at. Nothing is removed from anything.
  await page.keyboard.press('KeyP')
  const torn = await settled(page, () => window.__app.heldPin() !== null, 8000)
  const sheet = await page.evaluate(() => window.__app.heldPin())
  expect(torn, 'P tore nothing out').toBe(true)
  expect(sheet!.kind).toBe('page')
  expect(sheet!.page, 'a page number, so it can be rasterised again').toBeGreaterThan(0)

  // The book is untouched: it is still readable, and still has its pages.
  await page.keyboard.press('Escape')
  await settled(page, () => window.__app.stats().mode === 'walk', 8000)
  const stillThere = await page.evaluate(() => window.__app.readForTest('sample-book'))
  expect(stillThere.rendered, 'the book lost the page it was copied from').toBe(true)
  await page.keyboard.press('Escape')
  await settled(page, () => window.__app.stats().mode === 'walk', 8000)

  // Before anything is pinned: the board is hung at head height, not propped on
  // the skirting. `y` in the document is the centre of a hung thing, and the
  // renderer used to read it as the base — which put the office board's top edge
  // at 1.5 m, under the eye line of anybody standing in front of it, with the
  // pen tray by their knees.
  const boards = await page.evaluate(() => window.__app.boards())
  expect(boards.length, 'no whiteboard in the office').toBeGreaterThan(0)
  for (const board of boards) {
    // 1.68 is the standing eye line; 0.75 is desk height.
    expect(board.top, `${board.id} hangs below eye level`).toBeGreaterThan(1.68)
    expect(board.bottom, `${board.id} hangs down behind the desk`).toBeGreaterThan(0.75)
  }

  // Somewhere with plaster on it: the north wall east of the window and clear of
  // the bookcase, which is the one stretch of the great room that is only wall.
  await page.evaluate(() => window.__app.teleport(4.0, -3.2, 0, 0))
  await page.evaluate(() => window.__app.look(0, 0))
  const aimed = await settled(page, () => window.__app.pinTarget() !== null, 8000)
  expect(aimed, 'a wall a stride away was not offered as somewhere to pin').toBe(true)
  await expect(page.getByTestId('held-sheet-card')).toBeVisible()

  await page.keyboard.press('KeyE')
  const up = await settled(page, () => window.__app.pins().length === 1, 8000)
  expect(up, 'E did not pin it up').toBe(true)

  const pinned = (await page.evaluate(() => window.__app.pins()))[0]!
  expect(pinned.kind).toBe('page')
  expect(pinned.bookId).toBe('sample-book')
  // On the wall it was aimed at, not at the origin.
  expect(pinned.z).toBeLessThan(-3.5)
  expect(Math.abs(pinned.x - 4.0)).toBeLessThan(0.5)
  // Your hands are empty again.
  expect(await page.evaluate(() => window.__app.heldPin())).toBeNull()

  // And it comes back down into your hand, which is what makes moving one from a
  // wall to the whiteboard two presses of the same key.
  const seen = await settled(page, () => window.__app.focusedPin() !== null, 8000)
  expect(seen, 'the sheet on the wall was not offered').toBe(true)
  await page.keyboard.press('KeyE')
  const down = await settled(page, () => window.__app.pins().length === 0, 8000)
  expect(down, 'E did not take it down').toBe(true)
  expect(await page.evaluate(() => window.__app.heldPin())).not.toBeNull()
})

test('a note is written, stuck up, and is still there after a reload', async ({ page }) => {
  await boot(page)

  await page.keyboard.press('KeyT')
  await expect(page.getByTestId('note-field')).toBeVisible()
  await page.getByTestId('note-field').locator('input').fill('ask about the 1963 edition')
  await page.keyboard.press('Enter');

  const written = await settled(page, () => window.__app.heldPin() !== null, 8000)
  expect(written, 'the note never reached your hand').toBe(true)
  expect((await page.evaluate(() => window.__app.heldPin()))!.kind).toBe('note')

  await page.evaluate(() => window.__app.teleport(4.0, -3.2, 0, 0))
  await page.evaluate(() => window.__app.look(0, 0))
  expect(await settled(page, () => window.__app.pinTarget() !== null, 8000)).toBe(true)

  await page.keyboard.press('KeyE')
  expect(await settled(page, () => window.__app.pins().length === 1, 8000)).toBe(true)
  expect((await page.evaluate(() => window.__app.pins()))[0]!.text).toBe(
    'ask about the 1963 edition',
  )

  // Notes go in the layout document, so they survive the room being rebuilt.
  await boot(page)
  const after = await page.evaluate(() => window.__app.pins())
  expect(after.length, 'the note was not saved').toBe(1)
  expect(after[0]!.text).toBe('ask about the 1963 edition')
  expect(after[0]!.kind).toBe('note')
})

/**
 * The EPUB half of read mode.
 *
 * Everything above `reader/source.ts` is format-blind, which is the whole point
 * of that file — so what this proves is that a book with no pages until it is
 * set in type arrives in the same reader, with the same turn, and answers the
 * same questions about itself.
 */
test('an EPUB opens, is set in type, and turns like any other book', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await boot(page)

  const opened = await page.evaluate(() => window.__app.readForTest('sample-epub'))
  expect(opened.failure, 'the EPUB refused to open').toBeNull()
  expect(opened.rendered).toBe(true)
  // Pagination is the reader's, not the file's: four chapters of prose is a
  // good many pages of type, and how many is a fact about the layout.
  expect(opened.pages, 'the EPUB laid out to nothing').toBeGreaterThan(6)
  expect(opened.showing).toEqual([0, 1])

  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(() => window.__app.reader().spread === 1, null, { timeout: 20_000 })
  expect(await page.evaluate(() => window.__app.reader().showing)).toEqual([2, 3])

  // And it is the same book on the next open: pagination happens once, in
  // abstract units, so a page number means the same thing every session.
  const again = await page.evaluate(async () => {
    window.__app.setModeForTest('walk')
    return window.__app.readForTest('sample-epub')
  })
  expect(again.pages).toBe(opened.pages)
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
})

test('the catalogue finds a book and says where it is', async ({ page }) => {
  await boot(page)
  await unpackEverything(page)

  // The terminal is furniture, so where it is comes from the world rather than
  // from a coordinate written down here. Approached from the *north*, because
  // the desk it stands on is against the south end of the office and the poses
  // south of it are through a wall.
  const terminal = (await page.evaluate(() => window.__app.furniture())).find(
    (item) => item.kind === 'computer',
  )
  expect(terminal, 'this world has no catalogue terminal').toBeDefined()

  let found = false
  // North of it looking south (yaw = PI), then the other three bearings, so the
  // test survives somebody turning the desk round.
  outer: for (const bearing of [Math.PI, 0, Math.PI / 2, -Math.PI / 2]) {
    for (const back of [0.72, 0.95, 1.2]) {
      for (const pitch of [-0.6, -0.75, -0.45, -0.9]) {
        await page.evaluate(
          ([x, z, yaw, away]) => {
            // Stand `away` from it on this bearing, i.e. behind where you are
            // about to look.
            window.__app.teleport(x! + Math.sin(yaw!) * away!, z! + Math.cos(yaw!) * away!, yaw!, 0)
          },
          [terminal!.x, terminal!.z, bearing, back],
        )
        await page.evaluate(
          ([yaw, pitch]) => window.__app.look(yaw!, pitch!),
          [bearing, pitch],
        )
        found = await settled(page, () => window.__app.stats().focusedFixture !== null, 2500)
        if (found) break outer
      }
    }
  }
  expect(found, 'never found the catalogue terminal in the office').toBe(true)

  await page.keyboard.press('KeyE')
  await expect(page.getByTestId('catalogue')).toBeVisible()

  // While it is open the keyboard is the terminal's: W is a letter.
  const before = await page.evaluate(() => window.__app.player())
  await page.getByTestId('catalogue').locator('input').fill('shelf as argument')
  await expect(page.getByTestId('catalogue-results')).toContainText('The Shelf as Argument')
  // It says where the thing is, which is the whole of what an index does.
  await expect(page.getByTestId('catalogue-results')).toContainText(/shelf|box|left out/i)
  const after = await page.evaluate(() => window.__app.player())
  expect(Math.hypot(after.x - before.x, after.z - before.z), 'typing moved you').toBeLessThan(0.05)

  // A search with no answer says so rather than showing everything.
  await page.getByTestId('catalogue').locator('input').fill('zzzzz not in this library')
  await expect(page.getByTestId('catalogue-empty')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('catalogue')).toHaveCount(0)
})

test('the cat comes when called, and can be asked for a book', async ({ page }) => {
  test.slow()
  await boot(page)
  await unpackEverything(page)

  const start = await page.evaluate(() => window.__app.cat())
  expect(start.mood, 'the cat never got put anywhere').toBeTruthy()

  // Called. It is deliberately allowed to refuse if it was asleep — which is
  // the whole of what makes it read as an animal rather than a button — so this
  // asks until it is on its way rather than asserting on one call.
  const coming = await settled(
    page,
    () => {
      window.__app.callCatForTest()
      return window.__app.cat().mood === 'come'
    },
    10_000,
  )
  expect(coming, 'the cat ignored every call').toBe(true)

  // And it actually crosses the room to you rather than only intending to.
  const before = await page.evaluate(() => window.__app.cat())
  const you = await page.evaluate(() => window.__app.player())
  const away = Math.hypot(before.x - you.x, before.z - you.z)
  const nearer = await settled(
    page,
    () => {
      const cat = window.__app.cat()
      const me = window.__app.player()
      return Math.hypot(cat.x - me.x, cat.z - me.z) < 1.2
    },
    60_000,
  )
  expect(nearer, `the cat set off from ${away.toFixed(1)} m away and never arrived`).toBe(true)

  // Asked for a book: it goes to a case that has one, takes it down and brings
  // it back. What matters is that the book genuinely leaves the shelf — a cat
  // that conjured books would quietly double the library.
  const shelvedBefore = await page.evaluate(() => window.__app.stats().shelved)
  expect(await page.evaluate(() => window.__app.fetchBookForTest())).toBe(true)

  // It ends with the book on the floor at your feet, where it becomes an
  // ordinary loose book you can pick up. Waited for as one condition rather than
  // two, because the fetch and the delivery are a single errand and catching it
  // mid-carry is a race with a walking animal.
  const delivered = await settled(
    page,
    () => Object.keys(window.__app.looseBooks()).length > 0,
    120_000,
  )
  expect(delivered, 'the cat never brought a book back').toBe(true)

  // And the book genuinely left the shelf rather than being conjured.
  expect(await page.evaluate(() => window.__app.stats().shelved)).toBe(shelvedBefore - 1)
  expect(await page.evaluate(() => window.__app.cat().carrying)).toBeNull()
})

test('the main menu holds the room until you go in', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__app?.ready() === true, null, { timeout: 30_000 })

  // The room loads behind the menu — which is why `ready()` is already true —
  // but nothing reaches it: a movement key here must not be a step.
  await expect(page.getByTestId('main-menu')).toBeVisible()
  await expect(page.getByTestId('status')).toHaveCount(0)
  const before = await page.evaluate(() => window.__app.player())
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(700)
  await page.keyboard.up('KeyW')
  const after = await page.evaluate(() => window.__app.player())
  expect(Math.hypot(after.x - before.x, after.z - before.z), 'walked from the menu').toBeLessThan(
    0.05,
  )

  await page.getByTestId('enter-library').click()
  await expect(page.getByTestId('main-menu')).toHaveCount(0)
  await expect(page.getByTestId('status')).toBeVisible()
})

test('low performance mode is a switch, and the room survives it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await boot(page)

  await page.getByTestId('open-settings').click()
  await page.getByTestId('low-performance').click()
  await expect(page.getByTestId('low-performance')).toHaveAttribute('aria-pressed', 'true')

  // The canvas is remounted, because antialiasing and the shadow map are fixed
  // when the context is created. Everything that matters is in the stores, so
  // the room has to come back rather than come back empty.
  await page.waitForFunction(() => window.__app?.ready() === true, null, { timeout: 30_000 })
  const stats = await page.evaluate(() => window.__app.stats())
  expect(stats.rooms).toBe(9)
  expect(stats.books).toBeGreaterThan(100)
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
})

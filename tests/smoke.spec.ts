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
  focusedProp: string | null
  ordering: boolean
  phoning: 'menu' | 'paper' | null
}

type ShelfTarget = { shelf: number; shelfId: string; row: number; index: number }

type Book = { id: string; title: string; author: string | null; format: string }

/** A small prop — the cup, a can, a takeaway box — where it stands and what is in it. */
type Prop = {
  kind: 'cup' | 'can' | 'takeaway'
  full: boolean
  x: number
  y: number
  z: number
  yaw: number
}

type ReaderStatus = {
  bookId: string | null
  pages: number
  spread: number
  progress: number
  rendered: boolean
  showing: [number, number] | null
  turning: boolean
  pen: boolean
  failure: string | null
}

declare global {
  interface Window {
    __app: {
      ready: () => boolean
      stats: () => Stats
      /**
       * Point lights in the scene: how many exist, how many are carrying light,
       * and which candidate each pool slot is currently showing.
       */
      pointLights: () => { mounted: number; lit: number; bound: string[] }
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
        /** `performance.now()` before which the coffee is still working. */
        boostUntil: number
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
      crateView: (
        crateId: string,
      ) => { offset: number; shown: number; total: number; record: string | null } | null
      browseCrateForTest: (crateId: string, direction: 1 | -1) => void
      visibleInBoxes: () => string[]
      boxIds: () => string[]
      places: () => {
        shelves: { id: string; x: number; z: number; rotationY: number; rows: number }[]
        boxes: { id: string; x: number; z: number; height: number }[]
        crates: { id: string; x: number; z: number }[]
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
      placeCatForTest: (x: number, z: number, floor?: number) => void
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
      roms: () => string[]
      arcade: () => {
        inserted: string | null
        error: string | null
        running: boolean
        litPixels: number
      }
      heldRom: () => string | null
      insertRomForTest: (id: string) => Promise<void>
      ejectRomForTest: () => void
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
      heldMarker: () => string | null
      boardTarget: () => string | null
      takeMarkerForTest: (id: string) => void
      inkForTest: () => number
      drawingsOn: (boardId: string) => { ink: number; points: number[] }[]
      wipeBoardForTest: (boardId: string) => number
      heldRecord: () => string | null
      takeRecordForTest: (id: string | null) => void
      fileRecordForTest: (id: string, crateId: string) => void
      putRecordDownForTest: (
        id: string,
        at: { x: number; y: number; z: number; yaw: number },
      ) => void
      filedRecords: () => Record<string, string>
      looseRecords: () => Record<string, { x: number; y: number; z: number; yaw: number }>
      recordCrates: () => Record<string, string | null>
      reader: () => ReaderStatus
      readForTest: (id: string) => Promise<ReaderStatus>
      setModeForTest: (mode: string) => void
      bookmarksOf: (id: string) => number[]
      notesOf: (id: string) => { id: string; page: number; text: string; created: string }[]
      addNoteForTest: (
        id: string,
        page: number,
        text: string,
      ) => { id: string; page: number; text: string; created: string }
      deleteNoteForTest: (id: string, noteId: string) => boolean
      pageDrawingsOf: (id: string, page: number) => { ink: number; points: number[] }[]
      wipePageForTest: (id: string, page: number) => number
      inkPixelsOnPage: (page: number) => number
      spines: () => { printed: number; slots: number; reprinted: number }
      props: () => Record<string, Prop>
      heldProp: () => { kind: Prop['kind']; full: boolean } | null
      placePropForTest: (prop: Prop) => string
      takePropForTest: (id: string) => Prop | null
      consumeForTest: () => void
      wornLamp: () => string | null
      wearLampForTest: (id: string | null) => void
      deliverySpotForTest: () => { x: number; y: number; z: number; yaw: number } | null
    }
  }
}

/**
 * Load the app and go in. The room loads behind a main menu, and nothing reaches
 * it until the button is pressed — so a test that skipped this finds every key
 * dead.
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
 * A newly indexed library arrives boxed and stays that way, so most of what
 * follows starts by doing what you would do first in the room.
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
 * Wait for the crosshair to report something, or give up on this pose. The
 * raycast runs every other frame, so "has it noticed yet" is answered in frames
 * — and a fixed sleep reads stale nulls under load, which looks exactly like the
 * room being wrong. Resolves false rather than throwing, because "not from this
 * pose" is the normal answer.
 */
async function settled(page: Page, condition: () => boolean, timeout = 4000) {
  const deadline = Date.now() + timeout
  do {
    // From this side rather than `waitForFunction`, which polls on a page timer:
    // under the load this exists to tolerate, those timers are starved, and a
    // condition that became true reports as never having happened.
    if (await page.evaluate(condition)) return true
    await page.waitForTimeout(50)
  } while (Date.now() < deadline)
  return false
}

/**
 * The same, for a condition needing a value from this side: `page.evaluate`
 * serialises the function, so a closure over an id is a `ReferenceError`.
 */
async function settledWith(
  page: Page,
  arg: string[],
  condition: (value: string[]) => boolean,
  timeout = 4000,
) {
  const deadline = Date.now() + timeout
  do {
    if (await page.evaluate(condition, arg)) return true
    await page.waitForTimeout(50)
  } while (Date.now() < deadline)
  return false
}

/**
 * Stand in front of a bookcase, looking at a stocked compartment. Derived from
 * the world rather than written down: a test that knows where the bookcases were
 * fails the day the room is rearranged. Which rows are stocked is not fixed
 * either, so this sweeps the height of a case until the crosshair reports.
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
       * Waited for rather than slept through: one frame here can take longer
       * than any sleep short enough to sweep thirty poses with. What counts as
       * an answer depends on what is in your hands — asking for "either"
       * returns from a pose that found a book while the caller needed a shelf.
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
   * Alive and rendering, and only that — which is why it is a wait rather than a
   * reading. Counting frames in a fixed window would measure the host's spare
   * capacity; an allowance only a stopped render loop can fail measures the app.
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
 * Walking is measured in frames, not milliseconds: the controller caps its step
 * at 1/20 s, so distance covered is bounded by frames rendered and the same code
 * covers 1.9 m idle and 5 cm busy. Hold the key until the thing being tested has
 * happened, or give up — `settled()`'s distinction, for the walk.
 *
 * Budgets are minutes deliberately. A generous one still catches a stopped walk
 * controller, which is all it is for; a tight one reports how busy the host was.
 */
async function walkUntil(page: Page, reached: (z: number) => boolean, budgetMs = 60_000) {
  await page.keyboard.down('KeyW')
  const deadline = Date.now() + budgetMs
  try {
    while (Date.now() < deadline) {
      // From this side rather than `waitForFunction`: a saturated page starves
      // its timers, so nothing samples the walk while it is going on.
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

  // Holding a book, the crosshair looks for a shelf — which the pose that found
  // the book may not satisfy, since taking one leaves a gap to point through.
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

  // Sampled right through the turn. The leaf hides the swap, so the ordering
  // that matters is that it may not come down until the destination spread is
  // on the sheets — dropping it first exposes the stale one mid-render.
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
  // that, the kitchen, the bathroom off it, the office, the porch — and the
  // lake house and its deck, a trail away across the site.
  expect(stats.rooms).toBe(11)
  expect(stats.worldError).toBeNull()
  expect(await page.evaluate(() => window.__app.room())).toBe('main')

  // Through the west doorway into the reading corner. Walking is timed in
  // simulation steps, so this waits on arrival rather than on a duration.
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
    // …and all the way up, not part-way. The eye is part of the wait: the floor
    // threshold is crossed on the ramp, short of what standing measures.
    await page.waitForFunction(
      () => {
        const p = window.__app.player()
        return p.floor > 2.3 && p.eye > 3.92
      },
      null,
      { timeout: 90_000 },
    )
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
   * Falling is simulated per frame with the step clamped, so how far a book has
   * fallen after three seconds is a fact about the host's spare capacity.
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
   * Unpacking fills empty rows nearest the box and stops when the boxes run out,
   * so whether any particular row is stocked is not something to assume — a test
   * that did would fail the day somebody adds a bookcase.
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
 * Stand over a box and look into it, wherever the map puts it. Approached from
 * each side in turn, because a box can be against a wall or behind a chair.
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
  ).toContainText(/browse/i)

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

test('a crate can be riffled, so a record behind the front one can be reached', async ({
  page,
}) => {
  await boot(page)

  const crates = (await page.evaluate(() => window.__app.places())).crates
  expect(crates.length, 'this world has no record crate').toBeGreaterThan(0)

  // The crate the deal actually filled: with a small collection the second one
  // stands empty, and an empty crate has nothing to flick through.
  let crateId: string | null = null
  for (const crate of crates) {
    const view = await page.evaluate((id) => window.__app.crateView(id as string), crate.id)
    if (view && view.total > 1) {
      crateId = crate.id
      break
    }
  }
  expect(crateId, 'no crate was dealt more than one record').not.toBeNull()

  const first = await page.evaluate((id) => window.__app.crateView(id as string), crateId!)
  expect(first!.offset).toBe(0)
  expect(first!.record, 'the crate names no record at the cursor').not.toBeNull()

  // Forward: the cursor moves on and a different sleeve is the one E would take.
  await page.evaluate((id) => window.__app.browseCrateForTest(id as string, 1), crateId!)
  const next = await page.evaluate((id) => window.__app.crateView(id as string), crateId!)
  expect(next!.offset).toBe(1)
  expect(next!.record).not.toBe(first!.record)

  // And back to where it started, which is what the back-trail is for.
  await page.evaluate((id) => window.__app.browseCrateForTest(id as string, -1), crateId!)
  const back = await page.evaluate((id) => window.__app.crateView(id as string), crateId!)
  expect(back!.offset).toBe(0)
  expect(back!.record).toBe(first!.record)

  // The front of the crate does not run off its own end.
  await page.evaluate((id) => window.__app.browseCrateForTest(id as string, -1), crateId!)
  expect(
    (await page.evaluate((id) => window.__app.crateView(id as string), crateId!))!.offset,
  ).toBe(0)
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
  await expect(page.getByTestId('held-card')).toContainText(/drop in the box/i)

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
  // Directly rather than through the book-hunting sweep: kneeling is about eye
  // height, and on a boxed library the sweep burns the timeout finding nothing.
  await page.evaluate(() => {
    const s = window.__app.places().shelves[0]!
    window.__app.teleport(
      s.x + Math.sin(s.rotationY) * 0.85,
      s.z + Math.cos(s.rotationY) * 0.85,
      s.rotationY,
    )
    window.__app.look(s.rotationY, -0.4)
  })
  /** Eye height is eased, so a fixed sleep measures the frame rate, not the controller. */
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
  // A pose sweep and two eased settles, both counted in frames.
  test.slow()
  await boot(page)

  // Looking down at it, since an armchair is under a metre tall and a level
  // crosshair sails over the back. Its position comes from the world.
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
    const from = await page.evaluate(
      ([chair, away, pitch]) => {
        const c = chair as { x: number; z: number }
        // Approach from the west, which is the open side of this one.
        window.__app.teleport(c.x - (away as number), c.z, -Math.PI / 2)
        window.__app.look(-Math.PI / 2, pitch as number)
        return window.__app.stats().frames
      },
      [chair, away, pitch] as const,
    )
    // The crosshair is read on rendered frames, so this waits for frames.
    // Polled from this side, for the reason the seated settle below gives.
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const at = await page.evaluate(() => ({
        frames: window.__app.stats().frames,
        seat: window.__app.focusedSeat(),
      }))
      seen = at.seat
      if (seen !== null || at.frames > from + 4) break
      await page.waitForTimeout(150)
    }
    if (seen === 'chair') break
  }
  expect(seen, 'the armchair was not reachable from any pose').toBe('chair')
  await expect(page.getByTestId('seat-card')).toContainText(/sit down/i)

  await page.keyboard.press('KeyE')
  await page.waitForTimeout(600)

  expect(await page.evaluate(() => window.__app.seat())).toBe('chair')
  await expect(page.getByTestId('seated-card')).toContainText(/stand up/i)

  // Seated: lower than standing, at the chair, and walking does not move you.
  // Read once the ease has finished, or the walk is measured against a
  // position still on its way.
  await page.waitForFunction(() => window.__app.player().eye < 1.3, null, { timeout: 20_000 })

  // Polled from this side, for `settled`'s reason: the render loop starves page
  // timers. Two equal readings only count once a frame has been rendered
  // between them, or two polls inside one long frame read as "at rest".
  let previous = ''
  let previousFrame = -1
  let stopped = false
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const at = await page.evaluate(() => ({
      player: window.__app.player(),
      frames: window.__app.stats().frames,
    }))
    const now = `${at.player.x.toFixed(3)}:${at.player.z.toFixed(3)}`
    if (now === previous && at.frames > previousFrame) {
      stopped = true
      break
    }
    previous = now
    previousFrame = at.frames
    await page.waitForTimeout(400)
  }
  expect(stopped, 'the seated ease never came to rest').toBe(true)

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
 * Keep `fromFraction` off the right-hand edge: the panel is real UI over the
 * canvas there, and a pointer down on it grabs the panel, not the page.
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
  // Three animated turns with the whole cabin redrawn behind the book every
  // frame: this drives more of the app end to end than anything else here.
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

  // Open the book again: it resumes at the spread you left it on, which is what
  // `readProgress` is saved on every turn for.
  await page.evaluate(() => window.__app.readForTest('sample-book'))
  expect(await page.evaluate(() => window.__app.reader().spread)).toBe(1)
})

test('a note is written on the page, survives a reload, and can be rubbed out', async ({
  page,
}) => {
  test.slow()
  await boot(page)
  await page.evaluate(() => window.__app.readForTest('sample-book'))

  await page.keyboard.press('KeyN')
  await expect(page.getByTestId('book-note-field')).toBeVisible()
  await page.keyboard.type('check the colophon')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('book-note-field')).toHaveCount(0)

  // Spread 0's recto is page 1, by the tear-out convention.
  const written = await page.evaluate(() => window.__app.notesOf('sample-book'))
  expect(written).toHaveLength(1)
  expect(written[0]).toMatchObject({ page: 1, text: 'check the colophon' })

  // The reading card lists the notes on the pages you are looking at.
  await expect(page.getByTestId('reader-note')).toContainText('check the colophon')

  // The save is debounced; give it time to land before reloading.
  await page.waitForTimeout(1200)
  await reboot(page)
  const kept = await page.evaluate(() => window.__app.notesOf('sample-book'))
  expect(kept).toHaveLength(1)
  expect(kept[0]).toMatchObject({ page: 1, text: 'check the colophon' })

  // And the file speaks pages and titles, so it is legible without the app.
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('kleib3ry.annotations') ?? 'null'),
  )
  expect(stored.books['sample-book'].title).toBe('The Shelf as Argument')
  expect(stored.books['sample-book'].notes[0].page).toBe(1)

  // Rubbing it out from the reading card.
  await page.evaluate(() => window.__app.readForTest('sample-book'))
  await expect(page.getByTestId('reader-note')).toBeVisible()
  await page.getByTestId('delete-note').click()
  await expect(page.getByTestId('reader-note')).toHaveCount(0)
  expect(await page.evaluate(() => window.__app.notesOf('sample-book'))).toEqual([])
})

test('the pen draws on a page, the ink survives a reload, and a wipe takes it off', async ({
  page,
}) => {
  test.slow()
  await boot(page)
  await page.evaluate(() => window.__app.readForTest('sample-book'))

  // Pick the pen up: a drag must now be a line, not a page turn.
  await page.keyboard.press('KeyD')
  await page.waitForFunction(() => window.__app.reader().pen === true)

  const box = (await page.locator('canvas').boundingBox())!
  const y = box.y + box.height * 0.5
  await page.mouse.move(box.x + box.width * 0.56, y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(box.x + box.width * (0.56 + i * 0.01), y + i * 2)
  }
  await page.mouse.up()

  // The stroke landed on the recto (page 1 of spread 0) — and it did not turn
  // the page, which the same drag would have done with the pen down.
  await page.waitForFunction(
    () => window.__app.pageDrawingsOf('sample-book', 1).length === 1,
    null,
    { timeout: 10_000 },
  )
  expect(await page.evaluate(() => window.__app.reader().spread)).toBe(0)
  const stroke = (await page.evaluate(() => window.__app.pageDrawingsOf('sample-book', 1)))[0]!
  expect(stroke.points.length).toBeGreaterThanOrEqual(4)
  // Saved is not enough — the ink has to be on the page.
  expect(await page.evaluate(() => window.__app.inkPixelsOnPage(1))).toBeGreaterThan(0)

  // The save is debounced; give it time to land before reloading.
  await page.waitForTimeout(1200)
  await reboot(page)
  expect(await page.evaluate(() => window.__app.pageDrawingsOf('sample-book', 1))).toHaveLength(1)
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('kleib3ry.annotations') ?? 'null'),
  )
  expect(stored.books['sample-book'].drawings['1']).toHaveLength(1)

  // The wipe button on the reading card takes the ink off again.
  await page.evaluate(() => window.__app.readForTest('sample-book'))
  await page.getByTestId('wipe-page').click()
  await page.waitForFunction(() => window.__app.pageDrawingsOf('sample-book', 1).length === 0)
  await expect(page.getByTestId('wipe-page')).toHaveCount(0)
})

test('the pen draws visibly on an EPUB page too', async ({ page }) => {
  // The regression this guards: the EPUB type setter leaves a scale() on its
  // canvas context, and ink painted through it landed off the canvas — the
  // stroke saved, and nothing showed. Only counting pixels tells those apart.
  test.slow()
  await boot(page)
  await page.evaluate(() => window.__app.readForTest('sample-epub'))

  await page.keyboard.press('KeyD')
  await page.waitForFunction(() => window.__app.reader().pen === true)

  const box = (await page.locator('canvas').boundingBox())!
  const y = box.y + box.height * 0.5
  await page.mouse.move(box.x + box.width * 0.56, y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(box.x + box.width * (0.56 + i * 0.01), y + i * 2)
  }
  await page.mouse.up()

  await page.waitForFunction(
    () => window.__app.pageDrawingsOf('sample-epub', 1).length === 1,
    null,
    { timeout: 10_000 },
  )
  expect(await page.evaluate(() => window.__app.inkPixelsOnPage(1))).toBeGreaterThan(0)
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
   * Printing is spread over passes, so "how much is printed" is a function of
   * frames elapsed rather than wall clock: wait for the count to stop moving.
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
        // Both counters: `reprinted` can sit still between passes while
        // `printed` climbs. Several stable samples, or settling too early
        // reads the atlas as full at a third of what it holds.
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

  // Every book is still one draw call, which is the point of an atlas rather
  // than a text mesh per spine. The ceiling is loose because the books do not
  // set it — the furniture and the outdoor dressing do, and that is what this
  // number tracks. The margin is for furniture to come: going over it means
  // merging, not raising it.
  const stats = await page.evaluate(() => window.__app.stats())
  expect(stats.drawCalls).toBeLessThan(520)

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
   * Seventeen hundred books moved from one instanced mesh to another without
   * the camera moving, so the frame should cost the same either way. This is
   * the assertion that guards the atlas: a hard ceiling tracks how much
   * furniture is in the room, and this tracks whether a book costs anything.
   */
  expect(Math.abs(shelved.drawCalls - boxed.drawCalls)).toBeLessThan(20)
})

test('the lamp pool is a fixed size, however many lamps the building has', async ({ page }) => {
  await boot(page)

  /**
   * The pool re-ranks every eighth frame and hands slots over across a
   * crossfade, so everything here is answered in frames.
   */
  const waitFrames = async (n: number) => {
    const from = await page.evaluate(() => window.__app.stats().frames)
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      if ((await page.evaluate(() => window.__app.stats().frames)) >= from + n) return
      await page.waitForTimeout(50)
    }
  }
  await waitFrames(60)

  /**
   * The whole design rests on this number not moving: three.js compiles every
   * lit material against the count of point lights, so a count that changes as
   * you walk recompiles the room mid-stride. The default map declares nearly
   * forty lamps and reveals — if this reads like that, the pool is bypassed.
   */
  const cabin = await page.evaluate(() => window.__app.pointLights())
  expect(cabin.mounted, 'the pool grew to the size of the building').toBeLessThanOrEqual(10)
  expect(cabin.lit, 'nothing in the pool is carrying any light').toBeGreaterThan(0)

  // Walk to the other building. The bindings must move; the count must not.
  await page.evaluate(() => window.__app.teleport(-7.44, 0.9, 0))
  await waitFrames(60)
  const moved = await page.evaluate(() => window.__app.pointLights())
  expect(moved.mounted, 'the light count moved with the player').toBe(cabin.mounted)

  /**
   * Switching a lamp off makes the room cheaper rather than merely darker: an
   * unlit lamp is no candidate. The count itself does not move — freed slots
   * refill with window reveals, which is the pool working rather than leaking.
   */
  const lamps = await page.evaluate(() =>
    Object.entries(window.__app.lights())
      .filter(([, lit]) => lit)
      .map(([id]) => id),
  )
  expect(lamps.length, 'this world has no lamps alight').toBeGreaterThan(0)
  await page.evaluate((ids) => ids.forEach((id) => window.__app.toggleLightForTest(id)), lamps)
  await waitFrames(90)
  const dark = await page.evaluate(() => window.__app.pointLights())
  expect(dark.mounted, 'the count changed when the lamps went off').toBe(cabin.mounted)
  expect(
    dark.bound.filter((id) => lamps.includes(id)),
    'a lamp that is switched off is still holding a slot',
  ).toEqual([])
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
 * Derived from the world like `faceTheShelves`, because a test that knows where
 * the television was fails the day it is moved: asks where the piece is, stands
 * a stride back, and sweeps until the crosshair reports.
 */
async function facePiece(page: Page, kind: string, found: () => boolean) {
  const pieces = await page.evaluate(
    (want: string) => window.__app.furniture().filter((item) => item.kind === want),
    kind,
  )
  expect(pieces.length, `this world has no ${kind}`).toBeGreaterThan(0)

  // The pitch is worked out rather than swept: a tape crate is 22 cm tall, and
  // no fixed angle steep enough for that is shallow enough for a bookcase. `at`
  // is how far up the piece to aim, from its own base.
  const EYE = 1.68
  for (const piece of pieces) {
    for (const back of [0.6, 0.85, 1.15, -0.6, -0.85, -1.15]) {
      // A person's yaw of 0 looks north (-Z), so standing south of a piece you
      // face 0 and standing north of it you face PI.
      const yaw = back > 0 ? 0 : Math.PI
      for (const at of [0.12, 0.3, 0.55]) {
        await page.evaluate(
          ([x, z, floor, aim]) => window.__app.teleport(x!, z!, aim!, floor!),
          [piece.x, piece.z + back, piece.y, yaw],
        )
        await page.evaluate(
          ([aim, drop, away]) => window.__app.look(aim!, -Math.atan2(drop!, away!)),
          [yaw, EYE - at, Math.abs(back)],
        )
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
   * The placeholder tapes point at nothing, so playback fails — the interesting
   * case, and the one a container the WebView cannot decode produces. What must
   * not happen is silence: a failure nobody reports ate your cassette.
   */
  const reported = await settled(
    page,
    () => window.__app.nowWatching().error !== null || window.__app.nowWatching().playing !== null,
    10_000,
  )
  const watching = await page.evaluate(() => window.__app.nowWatching())
  expect(reported, `neither playing nor complaining: ${JSON.stringify(watching)}`).toBe(true)
})

test('a cartridge boots the arcade machine and the game draws on its screen', async ({ page }) => {
  await boot(page)

  const roms = await page.evaluate(() => window.__app.roms())
  expect(roms.length, 'nothing in roms/').toBeGreaterThan(0)

  // E on the box puts a cartridge in your hand. The crosshair check asks for
  // the *kind*, because the machine beside the box is a fixture too.
  const atBox = await facePiece(page, 'rombox', () =>
    window.__app
      .furniture()
      .some((f) => f.kind === 'rombox' && f.id === window.__app.stats().focusedFixture),
  )
  expect(atBox, 'never found the ROM box').toBe(true)
  await page.keyboard.press('KeyE')
  const held = await settled(page, () => window.__app.heldRom() !== null, 5000)
  expect(held, 'E did not take a cartridge').toBe(true)
  await expect(page.getByTestId('held-rom-card')).toBeVisible()

  const atMachine = await facePiece(page, 'arcade', () =>
    window.__app
      .furniture()
      .some((f) => f.kind === 'arcade' && f.id === window.__app.stats().focusedFixture),
  )
  expect(atMachine, 'never found the arcade machine').toBe(true)
  await page.keyboard.press('KeyE')

  // The browser driver's Pong is a real file, so the machine genuinely boots:
  // the emulator runs the ROM and pixels light on the tube. Patiently — the
  // boot is a fetch and the pixels need frames, and SwiftShader's are slow.
  const running = await settled(
    page,
    () => window.__app.arcade().running && window.__app.arcade().litPixels > 0,
    30_000,
  )
  const state = await page.evaluate(() => window.__app.arcade())
  expect(running, `the machine never lit: ${JSON.stringify(state)}`).toBe(true)

  // E again steps up to the controls; Esc steps away.
  await page.keyboard.press('KeyE')
  const playing = await settled(page, () => window.__app.stats().mode === 'play', 10_000)
  expect(playing, 'E at a running machine did not enter play mode').toBe(true)
  await page.keyboard.press('Escape')
  const walked = await settled(page, () => window.__app.stats().mode === 'walk', 10_000)
  expect(walked, 'Esc did not step away from the machine').toBe(true)

  // F takes the cartridge back out, and the screen goes dark with it.
  await page.keyboard.press('KeyF')
  const ejected = await settled(
    page,
    () => window.__app.heldRom() !== null && !window.__app.arcade().running,
    10_000,
  )
  expect(ejected, 'F did not eject the cartridge').toBe(true)
})

test('a record filed by hand stays in the crate you put it in', async ({ page }) => {
  await boot(page)

  const records = await page.evaluate(() => window.__app.records())
  expect(records.length, 'nothing in music/').toBeGreaterThan(0)
  const record = records[0]!

  await page.evaluate((id) => window.__app.takeRecordForTest(id), record)
  await expect(page.getByTestId('held-record-card')).toBeVisible()

  // Into a crate on purpose. The deal fills crates from the music folder's own
  // order, so the entry is only worth anything if it beats the deal.
  const crates = (await page.evaluate(() => window.__app.furniture()))
    .filter((item) => item.kind === 'recordshelf')
    .map((item) => item.id)
  expect(crates.length, 'this world has no record crate').toBeGreaterThan(0)
  const crate = crates[crates.length - 1]!

  await page.evaluate(([id, into]) => window.__app.fileRecordForTest(id!, into!), [record, crate])
  await page.evaluate(() => window.__app.takeRecordForTest(null))
  expect(await page.evaluate(() => window.__app.filedRecords())).toEqual({ [record]: crate })

  const filed = await settledWith(
    page,
    [record, crate],
    ([id, into]) => window.__app.recordCrates()[id!] === into,
    8000,
  )
  expect(filed, 'the record did not end up in the crate it was filed into').toBe(true)

  await reboot(page)
  expect(await page.evaluate(() => window.__app.filedRecords())).toEqual({ [record]: crate })

  // Q is the way out of any arrangement: back to wherever the folder deals it.
  await page.evaluate((id) => window.__app.takeRecordForTest(id), record)
  await page.keyboard.press('KeyQ')
  const letGo = await settled(page, () => window.__app.heldRecord() === null, 5000)
  expect(letGo, 'Q did not put the record back').toBe(true)
  expect(await page.evaluate(() => window.__app.filedRecords())).toEqual({})
})

test('a record set down on a table stays on the table, and survives a reload', async ({ page }) => {
  await boot(page)

  const records = await page.evaluate(() => window.__app.records())
  expect(records.length, 'nothing in music/').toBeGreaterThan(0)
  const record = records[0]!

  const table = (await page.evaluate(() => window.__app.furniture())).find(
    (item) => item.kind === 'table',
  )!

  // Aiming a sleeve at a table top from a headless driver is a pose hunt; what
  // this is about is that a record put down has a place of its own.
  await page.evaluate((id) => window.__app.takeRecordForTest(id), record)
  await page.evaluate(
    ([id, x, y, z]) =>
      window.__app.putRecordDownForTest(String(id), {
        x: Number(x),
        y: Number(y),
        z: Number(z),
        yaw: 0,
      }),
    [record, table.x, table.y + 0.75, table.z],
  )
  await page.evaluate(() => window.__app.takeRecordForTest(null))

  expect(Object.keys(await page.evaluate(() => window.__app.looseRecords()))).toEqual([record])

  // A record that is out of the crates is not drawn in one.
  const outOfCrate = await settledWith(
    page,
    [record],
    ([id]) => window.__app.recordCrates()[id!] === null,
    8000,
  )
  expect(outOfCrate, 'a record on a table is still filed in a crate').toBe(true)

  await reboot(page)
  const again = await page.evaluate(() => window.__app.looseRecords())
  expect(Object.keys(again), 'the record was not where it was left').toEqual([record])
})

test('the marker draws on the whiteboard, and the board keeps it', async ({ page }) => {
  await boot(page)

  const board = (await page.evaluate(() => window.__app.furniture())).find(
    (item) => item.kind === 'whiteboard',
  )!
  expect(await page.evaluate((id) => window.__app.drawingsOn(id), board.id)).toEqual([])

  const marker = (await page.evaluate(() => window.__app.furniture())).find(
    (item) => item.kind === 'marker',
  )!
  await page.evaluate((id) => window.__app.takeMarkerForTest(id), marker.id)
  await expect(page.getByTestId('held-marker-card')).toBeVisible()

  // Stand a stride off the board and look at it. It hangs on the office's south
  // wall facing north, so this is one pose rather than a hunt.
  await page.evaluate(
    ([x, z]) => window.__app.teleport(x!, z! - 1.4, Math.PI),
    [board.x, board.z],
  )
  await page.evaluate(() => window.__app.look(Math.PI, 0))
  const aimed = await settled(page, () => window.__app.boardTarget() !== null, 8000)
  expect(aimed, 'never found the whiteboard with the marker in hand').toBe(true)

  // Hold the button and sweep: the line follows the head. Waited for in frames,
  // since the stroke gains a point per frame and a sleep can span zero of them.
  await page.mouse.down()
  for (const yaw of [-0.12, -0.06, 0, 0.06, 0.12]) {
    await page.evaluate((y) => window.__app.look(Math.PI + y, 0), yaw)
    const seen = await page.evaluate(() => window.__app.stats().frames)
    await page.waitForFunction(
      (was) => window.__app.stats().frames > was + 1,
      seen,
      { timeout: 60_000, polling: 100 },
    )
  }
  await page.mouse.up()

  const drawn = await settledWith(
    page,
    [board.id],
    ([id]) => window.__app.drawingsOn(id!).length > 0,
    8000,
  )
  const strokes = await page.evaluate((id) => window.__app.drawingsOn(id), board.id)
  expect(drawn, `nothing was drawn: ${JSON.stringify(strokes)}`).toBe(true)
  expect(strokes[0]!.points.length, 'a stroke of one point is not a line').toBeGreaterThan(4)

  // It is part of the library, so it comes back with it.
  await reboot(page)
  const after = await page.evaluate((id) => window.__app.drawingsOn(id), board.id)
  expect(after.length, 'the drawing did not survive a reload').toBe(strokes.length)

  // And G wipes it. Pressed for real rather than called: the marker has to
  // still be in hand and the board still under the crosshair after a reload,
  // and neither survives one — so both are set up again first.
  await page.evaluate((id) => window.__app.takeMarkerForTest(id), marker.id)
  await page.evaluate(
    ([x, z]) => window.__app.teleport(x!, z! - 1.4, Math.PI),
    [board.x, board.z],
  )
  await page.evaluate(() => window.__app.look(Math.PI, 0))
  expect(await settled(page, () => window.__app.boardTarget() !== null, 8000)).toBe(true)

  await page.keyboard.press('KeyG')
  const wiped = await settledWith(
    page,
    [board.id],
    ([id]) => window.__app.drawingsOn(id!).length === 0,
    5000,
  )
  expect(wiped, 'G did not wipe the board').toBe(true)
})

test('a page torn out of a book pins to a wall, and the book keeps its own', async ({ page }) => {
  // Two full book opens before it gets to the wall, so the page textures are
  // resident and every frame after that is slower.
  test.slow()
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

  // The board is hung at head height, not propped on the skirting. `y` is the
  // centre of a hung thing; read as the base, the top edge lands under the eye
  // line of anybody standing in front of it, with the pen tray by their knees.
  const boards = await page.evaluate(() => window.__app.boards())
  expect(boards.length, 'no whiteboard in the office').toBeGreaterThan(0)
  for (const board of boards) {
    // 1.68 is the standing eye line; 0.75 is desk height.
    expect(board.top, `${board.id} hangs below eye level`).toBeGreaterThan(1.68)
    expect(board.bottom, `${board.id} hangs down behind the desk`).toBeGreaterThan(0.75)
  }

  // Somewhere with plaster on it: the south wall between the window and the
  // porch door. Waited for the settled aim, not the first non-null target —
  // closing the book eases the camera back over several frames, and an E fired
  // at the first hit pins the page wherever it was pointing mid-glide.
  await page.evaluate(() => window.__app.teleport(1.5, 3.2, Math.PI, 0))
  await page.evaluate(() => window.__app.look(Math.PI, 0))
  const aimed = await settled(
    page,
    () => {
      const target = window.__app.pinTarget()
      return target !== null && Math.abs(target.x - 1.5) < 0.15
    },
    60_000,
  )
  expect(aimed, 'a wall a stride away was not offered as somewhere to pin').toBe(true)
  await expect(page.getByTestId('held-sheet-card')).toBeVisible()

  await page.keyboard.press('KeyE')
  const up = await settled(page, () => window.__app.pins().length === 1, 8000)
  expect(up, 'E did not pin it up').toBe(true)

  const pinned = (await page.evaluate(() => window.__app.pins()))[0]!
  expect(pinned.kind).toBe('page')
  expect(pinned.bookId).toBe('sample-book')
  // On the wall it was aimed at, not at the origin.
  expect(pinned.z).toBeGreaterThan(3.5)
  expect(Math.abs(pinned.x - 1.5)).toBeLessThan(0.5)
  // Your hands are empty again.
  expect(await page.evaluate(() => window.__app.heldPin())).toBeNull()

  // And it comes back down into your hand, which is what makes moving one from a
  // wall to the whiteboard two presses of the same key.
  const seen = await settled(page, () => window.__app.focusedPin() !== null, 30_000)
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

  await page.evaluate(() => window.__app.teleport(1.5, 3.2, Math.PI, 0))
  await page.evaluate(() => window.__app.look(Math.PI, 0))
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
 * Everything above `reader/source.ts` is format-blind, so this proves that a
 * book with no pages until it is set in type arrives in the same reader, with
 * the same turn, answering the same questions.
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
  // The leaf falls in rendered frames — the step is clamped, so the fall needs
  // seventeen of them plus both faces rasterising. A minute-scale budget like
  // `walkUntil`'s: here to catch a leaf that never lands, not to time one.
  await page.waitForFunction(() => window.__app.reader().spread === 1, null, { timeout: 60_000 })
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

  // Where it is comes from the world. Approached from the north, because its
  // desk is against the south end of the office and poses there are in a wall.
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

  // Stand at the bookcases before any of this. The steering is deliberately
  // unplanned — see `Cat.tsx` — so an errand across the whole building is a
  // test of the pathfinding it does not have, and none of that is the point.
  const nearest = (await page.evaluate(() => window.__app.places())).shelves[0]!
  await page.evaluate(
    ([x, z]) => window.__app.teleport(x! + 1.4, z!, Math.PI / 2, 0),
    [nearest.x, nearest.z],
  )
  await page.evaluate(
    ([x, z]) => window.__app.placeCatForTest(x! + 3.0, z! + 1.2, 0),
    [nearest.x, nearest.z],
  )

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

  // And it actually crosses the room rather than only intending to. The budget
  // is wall-clock but the walk is not: with the frame delta clamped, ten metres
  // at two frames a second is minutes rather than seconds.
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
    180_000,
  )
  expect(nearer, `the cat set off from ${away.toFixed(1)} m away and never arrived`).toBe(true)

  // Asked for a book: it goes to a case that has one, takes it down and brings
  // it back. What matters is that the book genuinely leaves the shelf — a cat
  // that conjured books would quietly double the library.
  const shelvedBefore = await page.evaluate(() => window.__app.stats().shelved)
  expect(await page.evaluate(() => window.__app.fetchBookForTest())).toBe(true)

  // It ends with the book at your feet, an ordinary loose book. One condition
  // rather than two: catching it mid-carry is a race with a walking animal.
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

test('the telephone asks what you want before it orders anything', async ({ page }) => {
  await boot(page)

  const at = await facePiece(page, 'phone', () => window.__app.stats().focusedFixture === 'phone')
  expect(at, 'never found the telephone').toBe(true)

  await page.keyboard.press('KeyE')
  await expect(page.getByTestId('phone-card')).toBeVisible()
  // Picking it up is not ordering: nothing is on its way until you say what.
  expect(await page.evaluate(() => window.__app.stats().ordering)).toBe(false)
  // A driver with no library folder has nowhere to put a paper, and the option
  // says so rather than failing at the end of a keystroke.
  await expect(page.getByTestId('order-paper')).toBeDisabled()

  // And the room has its keyboard back the moment you hang up.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('phone-card')).toHaveCount(0)
  expect(await page.evaluate(() => window.__app.stats().phoning)).toBeNull()
})

test('a can lives a whole life: set down, picked up, drunk, and still an empty', async ({ page }) => {
  await boot(page)

  // The kitchen the cans come from is furnished: fridge, bin, telephone.
  const kinds = await page.evaluate(() => window.__app.furniture().map((item) => item.kind))
  for (const kind of ['fridge', 'bin', 'phone', 'headlamp']) {
    expect(kinds, `the default map has no ${kind}`).toContain(kind)
  }

  // A cold can standing on the kitchen table, as taking one from the fridge
  // and setting it down leaves it.
  const id = await page.evaluate(() => {
    const table = window.__app.furniture().find((item) => item.kind === 'table')!
    return window.__app.placePropForTest({
      kind: 'can',
      full: true,
      x: table.x,
      y: table.y + 0.76,
      z: table.z,
      yaw: 0,
    })
  })
  expect(Object.keys(await page.evaluate(() => window.__app.props()))).toEqual([id])

  // Picked back up and drunk. An empty can is still a can — the bin is where
  // it stops being one — and only the coffee makes you quicker.
  await page.evaluate((id) => window.__app.takePropForTest(id), id)
  expect(await page.evaluate(() => window.__app.heldProp())).toEqual({ kind: 'can', full: true })
  await page.evaluate(() => window.__app.consumeForTest())
  expect(await page.evaluate(() => window.__app.heldProp())).toEqual({ kind: 'can', full: false })
  expect((await page.evaluate(() => window.__app.player())).boostUntil).toBe(0)

  // Drinking an empty does nothing further.
  await page.evaluate(() => window.__app.consumeForTest())
  expect(await page.evaluate(() => window.__app.heldProp())).toEqual({ kind: 'can', full: false })
})

test('the coffee works, and there is exactly one cup', async ({ page }) => {
  await boot(page)

  // The cup always lands under its one id: two cups is not a thing that happens.
  const id = await page.evaluate(() =>
    window.__app.placePropForTest({ kind: 'cup', full: true, x: 0, y: 0.8, z: 0, yaw: 0 }),
  )
  expect(id).toBe('cup')

  await page.evaluate(() => window.__app.takePropForTest('cup'))
  await page.evaluate(() => window.__app.consumeForTest())

  // Drunk: the cup is empty and the clock says you are quicker for a while yet.
  expect(await page.evaluate(() => window.__app.heldProp())).toEqual({ kind: 'cup', full: false })
  const left = await page.evaluate(() => window.__app.player().boostUntil - performance.now())
  expect(left).toBeGreaterThan(60_000)
})

test('a prop set down survives a reload', async ({ page }) => {
  await boot(page)
  await page.evaluate(() =>
    window.__app.placePropForTest({ kind: 'takeaway', full: false, x: 1.2, y: 0, z: 2.4, yaw: 0.5 }),
  )
  // Past the layout save debounce, so the write has landed before the reload.
  await page.waitForTimeout(900)
  await reboot(page)

  const kept = Object.values(await page.evaluate(() => window.__app.props()))
  expect(kept).toHaveLength(1)
  expect(kept[0]).toMatchObject({ kind: 'takeaway', full: false, x: 1.2, z: 2.4 })
})

test('the takeaway at the porch steps is really under the crosshair', async ({ page }) => {
  await boot(page)

  // A box exactly where the courier leaves one.
  const spot = await page.evaluate(() => window.__app.deliverySpotForTest())
  expect(spot).not.toBeNull()
  await page.evaluate(
    (at) => window.__app.placePropForTest({ kind: 'takeaway', full: true, ...at }),
    spot!,
  )

  // Stand a step north of it — on the deck's edge — and look down at it,
  // sweeping the pitch the way the shelf tests sweep a bookcase.
  let found = false
  for (const pitch of [-1.0, -0.8, -1.2, -0.6]) {
    await page.evaluate(
      ([at, pitch]) => {
        const spot = at as { x: number; y: number; z: number }
        window.__app.teleport(spot.x, spot.z - 1.1, Math.PI, spot.y)
        window.__app.look(Math.PI, pitch as number)
      },
      [spot, pitch] as const,
    )
    found = await settled(page, () => window.__app.stats().focusedProp !== null)
    if (found) break
  }
  expect(found, 'the crosshair never found the box on the grass').toBe(true)

  // E takes it — the real key, through the real raycast.
  await page.keyboard.press('KeyE')
  const took = await settled(page, () => window.__app.heldProp()?.kind === 'takeaway')
  expect(took, 'E did not pick the box up').toBe(true)
  expect(Object.keys(await page.evaluate(() => window.__app.props()))).toHaveLength(0)
})

test('the headlamp is worn, not held, and comes off again', async ({ page }) => {
  await boot(page)

  const hook = await page.evaluate(
    () => window.__app.furniture().find((item) => item.kind === 'headlamp') ?? null,
  )
  expect(hook, 'the default map keeps a headlamp on the porch table').not.toBeNull()

  await page.evaluate((id) => window.__app.wearLampForTest(id), hook!.id)
  expect(await page.evaluate(() => window.__app.wornLamp())).toBe(hook!.id)
  await expect(page.getByTestId('worn-lamp-card')).toBeVisible()
  // Worn is not held: both hands stay free for books.
  expect(await page.evaluate(() => window.__app.heldProp())).toBeNull()

  await page.evaluate(() => window.__app.wearLampForTest(null))
  expect(await page.evaluate(() => window.__app.wornLamp())).toBeNull()
  await expect(page.getByTestId('worn-lamp-card')).toHaveCount(0)
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
  expect(stats.rooms).toBe(11)
  expect(stats.books).toBeGreaterThan(100)
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
})

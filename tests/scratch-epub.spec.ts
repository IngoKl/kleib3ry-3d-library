import { expect, test, type Page } from '@playwright/test'

const SHOTS =
  'C:/Users/iklei/AppData/Local/Temp/claude/c--Users-iklei-Desktop-library/8fc8b1a1-2549-4462-b725-6eea77ecda49/scratchpad'

async function boot(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => window.__app?.ready() === true, null, { timeout: 30_000 })
  await page.getByTestId('enter-library').click()
  await expect(page.getByTestId('main-menu')).toHaveCount(0)
}

async function settled(page: Page, condition: () => boolean, timeout = 8000) {
  const deadline = Date.now() + timeout
  do {
    if (await page.evaluate(condition)) return true
    await page.waitForTimeout(50)
  } while (Date.now() < deadline)
  return false
}

test('scratch: a page torn out of an EPUB', async ({ page }) => {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text())
  })
  await boot(page)

  const opened = await page.evaluate(() => window.__app.readForTest('sample-epub'))
  console.log('EPUB READER', JSON.stringify(opened))
  expect(opened.rendered, opened.failure ?? '').toBe(true)

  await page.keyboard.press('KeyP')
  expect(await settled(page, () => window.__app.heldPin() !== null)).toBe(true)
  console.log('HELD', JSON.stringify(await page.evaluate(() => window.__app.heldPin())))
  await page.keyboard.press('Escape')
  expect(
    await settled(
      page,
      () => window.__app.stats().mode === 'walk' && window.__app.stats().reading === null,
      15_000,
    ),
  ).toBe(true)

  // The office whiteboard.
  await page.evaluate(() => window.__app.teleport(8.0, 7.55, Math.PI, 0))
  await page.evaluate(() => window.__app.look(Math.PI, 0.05))
  let aimed = await settled(page, () => window.__app.pinTarget() !== null, 6_000)
  if (!aimed) {
    for (const [x, z, pitch] of [
      [8.0, 7.8, 0.0],
      [8.0, 7.3, 0.1],
      [8.0, 7.9, -0.1],
      [7.5, 7.6, 0.05],
    ] as const) {
      await page.evaluate(([x, z]) => window.__app.teleport(x, z, Math.PI, 0), [x, z] as const)
      await page.evaluate((p) => window.__app.look(Math.PI, p), pitch)
      aimed = await settled(page, () => window.__app.pinTarget() !== null, 3_000)
      console.log('POSE', x, z, pitch, aimed)
      if (aimed) break
    }
  }
  console.log('STATS', JSON.stringify(await page.evaluate(() => window.__app.stats())).slice(0, 900))
  console.log('PLAYER', JSON.stringify(await page.evaluate(() => window.__app.player())))
  expect(aimed).toBe(true)
  await page.keyboard.press('KeyE')
  expect(await settled(page, () => window.__app.pins().length === 1)).toBe(true)
  await page.waitForTimeout(6000)
  await page.screenshot({ path: `${SHOTS}/epub-pin.png` })
})

test('scratch: books left open on the floor', async ({ page }) => {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text())
  })
  await boot(page)
  await page.evaluate(() => window.__app.teleport(0, 0, 0, 0))
  await page.evaluate(() => window.__app.look(0, -1.2))
  await page.evaluate(() => {
    window.__app.putDownForTest('sample-book', {
      x: -0.25, y: 0.01, z: -0.42, yaw: 0, open: true, spread: 1,
    })
    window.__app.putDownForTest('sample-epub', {
      x: 0.25, y: 0.01, z: -0.42, yaw: 0, open: true, spread: 2,
    })
  })
  await page.waitForTimeout(10_000)
  await page.screenshot({ path: `${SHOTS}/open-books.png` })
})

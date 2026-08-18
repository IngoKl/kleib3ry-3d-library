import { expect, test } from '@playwright/test'
import { describeEta, etaMs } from '../src/lib/scanEta'

/**
 * The scan's time-left estimate: a plain ratio, and the words it is said in.
 * Pure numbers in, pure words out — no page needed.
 */

test('the estimate is the remaining work at the pace so far', () => {
  // 100 of 400 files took 10 s: three times that much again to go.
  expect(etaMs(100, 400, 10_000)).toBe(30_000)
})

test('no estimate before the first file, after the last, or with no clock', () => {
  expect(etaMs(0, 400, 5_000)).toBeNull()
  expect(etaMs(400, 400, 5_000)).toBeNull()
  expect(etaMs(100, 400, 0)).toBeNull()
  expect(etaMs(0, 0, 0)).toBeNull()
})

test('the words stay as rough as the number', () => {
  expect(describeEta(3_000)).toBe('a few seconds left')
  expect(describeEta(45_000)).toBe('about a minute left')
  expect(describeEta(150_000)).toBe('about 3 min left')
  expect(describeEta(59.4 * 60_000)).toBe('about 59 min left')
  expect(describeEta(60 * 60_000)).toBe('about 1 h left')
  expect(describeEta(65 * 60_000)).toBe('about 1 h 5 min left')
})

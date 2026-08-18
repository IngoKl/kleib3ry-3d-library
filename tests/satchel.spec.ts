import { expect, test } from '@playwright/test'
import { pressSatchel, type SatchelItem } from '../src/state/satchel'

/**
 * The satchel's one-key discipline: a queue holding at most one book and one
 * record. Pure state in, pure state out — no page needed.
 */

const book = (id: string): SatchelItem => ({ kind: 'book', id })
const record = (id: string): SatchelItem => ({ kind: 'record', id })

test('a held book stows into an empty bag', () => {
  const press = pressSatchel([], book('b1'))
  expect(press.satchel).toEqual([book('b1')])
  expect(press.taken).toBeNull()
  expect(press.moved).toBe(true)
})

test('a record stows alongside a book — one of each fits', () => {
  const press = pressSatchel([book('b1')], record('r1'))
  expect(press.satchel).toEqual([book('b1'), record('r1')])
  expect(press.taken).toBeNull()
})

test('empty-handed takes out what went in first', () => {
  const press = pressSatchel([book('b1'), record('r1')], null)
  expect(press.taken).toEqual(book('b1'))
  expect(press.satchel).toEqual([record('r1')])
})

test('take, stow, take reaches the other item rather than looping', () => {
  // Both stowed, hands free: the first press hands back the book.
  const first = pressSatchel([book('b1'), record('r1')], null)
  expect(first.taken).toEqual(book('b1'))
  // Stowing it sends it to the back of the queue…
  const second = pressSatchel(first.satchel, first.taken)
  expect(second.taken).toBeNull()
  // …so the next press hands back the record.
  const third = pressSatchel(second.satchel, null)
  expect(third.taken).toEqual(record('r1'))
})

test('stowing a second book swaps it for the stowed one', () => {
  const press = pressSatchel([book('b1'), record('r1')], book('b2'))
  expect(press.taken).toEqual(book('b1'))
  expect(press.satchel).toContainEqual(book('b2'))
  expect(press.satchel).toContainEqual(record('r1'))
  expect(press.satchel).toHaveLength(2)
})

test('an empty bag and an empty hand is the one dead press', () => {
  const press = pressSatchel([], null)
  expect(press.moved).toBe(false)
  expect(press.taken).toBeNull()
  expect(press.satchel).toEqual([])
})

test('the bag never holds two of a kind', () => {
  let satchel: SatchelItem[] = []
  for (const item of [book('b1'), record('r1'), book('b2'), record('r2'), book('b3')]) {
    satchel = pressSatchel(satchel, item).satchel
    expect(satchel.filter((held) => held.kind === 'book').length).toBeLessThanOrEqual(1)
    expect(satchel.filter((held) => held.kind === 'record').length).toBeLessThanOrEqual(1)
  }
  expect(satchel).toEqual([record('r2'), book('b3')])
})

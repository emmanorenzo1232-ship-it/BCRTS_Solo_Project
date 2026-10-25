import { afterEach, expect, it, vi } from 'vitest'
import { todayInBarangay } from '../dates'

afterEach(() => vi.restoreAllMocks())

it.each([
  ['2026-10-25T15:59:59Z', '2026-10-25'],
  ['2026-10-25T16:00:00Z', '2026-10-26'],
])('uses the Philippine calendar date at %s', (instant, expected) => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(instant))
  expect(todayInBarangay()).toBe(expected)
})

import { expect, test } from 'bun:test';

import { SystemClock } from '../../../src/infrastructure/time/system-clock.js';

test('returns the current system time as a Date', () => {
  const before = Date.now();
  const currentTime = new SystemClock().now();
  const after = Date.now();

  expect(currentTime).toBeInstanceOf(Date);
  expect(currentTime.getTime()).toBeGreaterThanOrEqual(before);
  expect(currentTime.getTime()).toBeLessThanOrEqual(after);
});

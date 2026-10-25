import { expect, test } from 'vitest';
import { extrapolate } from './motion';

test('extrapolate moves along velocity and clamps the gap', () => {
  const p = { x: 0, y: 0, z: 0 };
  const v = { x: 10, y: 0, z: 0 };
  expect(extrapolate(p, v, 2)).toEqual({ x: 20, y: 0, z: 0 });
  expect(extrapolate(p, v, 30)).toEqual({ x: 50, y: 0, z: 0 });
  expect(extrapolate(p, v, -1)).toEqual({ x: 0, y: 0, z: 0 });
});

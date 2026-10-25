import { expect, test } from 'vitest';
import { describeLogEntry } from './describeLogEntry';

const name = (id: string) => ({ 'london-west': 'London West', tunis: 'Tunis' })[id] ?? id;
const base = { timeMs: 0, receiverId: 'london-west' };

test('every decision reads as one plain sentence', () => {
  expect(
    describeLogEntry(
      { ...base, type: 'handoff', fromSatId: 'PWR-02', toSatId: 'PWR-90', label: 'BAW1', timeToContactS: 16 },
      name,
    ),
  ).toBe('Handoff London West PWR-02 → PWR-90 (BAW1 in 16 s)');
  expect(
    describeLogEntry({ ...base, type: 'intrusion-predicted', fromSatId: 'PWR-02', label: 'BAW1', timeToContactS: 16 }, name),
  ).toBe('Predicted: BAW1 crosses PWR-02 beam in 16 s');
  expect(
    describeLogEntry({ ...base, type: 'throttle', fromSatId: 'PWR-02', label: 'BAW1', timeToContactS: 9 }, name),
  ).toBe('Throttled PWR-02 at London West (BAW1 in 9 s)');
  expect(describeLogEntry({ ...base, type: 'restore', toSatId: 'PWR-02' }, name)).toBe('Restored PWR-02 at London West');
  expect(describeLogEntry({ ...base, type: 'pass-handoff', fromSatId: 'PWR-02', toSatId: 'PWR-31' }, name)).toBe(
    'Pass handoff London West PWR-02 → PWR-31',
  );
  expect(describeLogEntry({ timeMs: 0, receiverId: 'tunis', type: 'no-coverage' }, name)).toBe('No clean satellite for Tunis');
});

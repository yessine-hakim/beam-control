import type { LogEntry } from './types';

/** One audit-log entry in plain words. */
export function describeLogEntry(e: LogEntry, receiverName: (id: string) => string): string {
  const where = receiverName(e.receiverId);
  const why = e.label ? ` (${e.label} in ${e.timeToContactS} s)` : '';
  switch (e.type) {
    case 'intrusion-predicted':
      return `Predicted: ${e.label} crosses ${e.fromSatId} beam in ${e.timeToContactS} s`;
    case 'handoff':
      return `Handoff ${where} ${e.fromSatId} → ${e.toSatId}${why}`;
    case 'pass-handoff':
      return `Pass handoff ${where} ${e.fromSatId} → ${e.toSatId}`;
    case 'throttle':
      return `Throttled ${e.fromSatId} at ${where}${why}`;
    case 'restore':
      return `Restored ${e.toSatId} at ${where}`;
    case 'no-coverage':
      return `No clean satellite for ${where}`;
  }
}

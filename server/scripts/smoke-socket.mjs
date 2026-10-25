// Dev check: connect like a browser, print receiver power, launch a drill and
// wait for the handoff it should cause. Run with the server up on :3000.
import { io } from 'socket.io-client';

const socket = io(process.env.BEAM_CONTROL_URL ?? 'http://localhost:3000');
const timeout = setTimeout(() => {
  console.error('No handoff within 25 s');
  process.exit(1);
}, 25_000);

let drilled = false;
socket.on('snapshot', (snap) => {
  if (!drilled) {
    drilled = true;
    console.log(snap.receivers.map((r) => `${r.id} ${Math.round(r.deliveredMW)}/${r.capacityMW} MW via ${r.servingSatId}`).join(' | '));
    socket.emit('drill', null, (ack) => console.log('drill ack', ack));
    return;
  }
  const handoff = snap.log.find((e) => e.type === 'handoff' && e.objectKey?.startsWith('drill:'));
  if (handoff) {
    console.log(`handoff ${handoff.receiverId} ${handoff.fromSatId} → ${handoff.toSatId} (${handoff.label} in ${handoff.timeToContactS} s)`);
    clearTimeout(timeout);
    socket.close();
  }
});

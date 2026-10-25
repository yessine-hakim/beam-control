import * as Cesium from 'cesium';
import type { WireSnapshot } from './types';

/** Frame a receiver side-on to its serving beam, so the beam reads as a line rising into the sky. */
export function flyToReceiver(viewer: Cesium.Viewer, receiverId: string, snapshot: WireSnapshot | null) {
  const r = snapshot?.receivers.find((x) => x.id === receiverId);
  if (!r) return;
  const ground = Cesium.Cartesian3.fromDegrees(r.lon, r.lat);
  const beam = snapshot!.beams.find((b) => b.receiverId === r.id && b.satId === r.servingSatId);
  let heading = 0;
  let center = ground;
  if (beam) {
    const d = Cesium.Cartesian3.subtract(new Cesium.Cartesian3(beam.from.x, beam.from.y, beam.from.z), ground, new Cesium.Cartesian3());
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(ground);
    const east = Cesium.Matrix4.getColumn(enu, 0, new Cesium.Cartesian4());
    const north = Cesium.Matrix4.getColumn(enu, 1, new Cesium.Cartesian4());
    const azimuth = Math.atan2(
      Cesium.Cartesian3.dot(d, new Cesium.Cartesian3(east.x, east.y, east.z)),
      Cesium.Cartesian3.dot(d, new Cesium.Cartesian3(north.x, north.y, north.z)),
    );
    heading = azimuth + Math.PI / 2;
    Cesium.Cartesian3.normalize(d, d);
    // Aim 15 km up the beam: receiver low in frame, beam rising.
    center = Cesium.Cartesian3.add(ground, Cesium.Cartesian3.multiplyByScalar(d, 15e3, d), new Cesium.Cartesian3());
  }
  viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, 1), {
    offset: new Cesium.HeadingPitchRange(heading, Cesium.Math.toRadians(-8), 80e3),
    duration: 3,
  });
}

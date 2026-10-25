// Draws one server snapshot into the Cesium scene. Entities are keyed by id,
// created once and updated in place; anything absent from the snapshot goes.
import * as Cesium from 'cesium';
import type { Vec3, WireSnapshot } from '../types';
import { extrapolate } from './motion';

const ORANGE = Cesium.Color.fromCssColorString('#ffa630');
const RED = Cesium.Color.fromCssColorString('#ff4d4d');
const CYAN = Cesium.Color.fromCssColorString('#4dd2ff');
const WHITE = Cesium.Color.WHITE;

const PLANE_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">' +
      '<path fill="#ffffff" stroke="#0b1220" stroke-width="0.8" d="M12 2c.8 0 1.3.9 1.3 2v5.2l7.2 4.3v2l-7.2-2.2v4.4l2.2 1.7v1.6L12 20.1 8.5 21v-1.6l2.2-1.7v-4.4l-7.2 2.2v-2l7.2-4.3V4c0-1.1.5-2 1.3-2z"/></svg>',
  );

const toC3 = (p: Vec3) => new Cesium.Cartesian3(p.x, p.y, p.z);

const label = (text: string, color: Cesium.Color, options: Partial<Cesium.LabelGraphics.ConstructorOptions> = {}) => ({
  text,
  font: '600 12px system-ui, sans-serif',
  fillColor: color,
  outlineColor: Cesium.Color.BLACK,
  outlineWidth: 3,
  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
  verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
  pixelOffset: new Cesium.Cartesian2(0, -12),
  disableDepthTestDistance: Number.POSITIVE_INFINITY,
  ...options,
});

export function createSceneRenderer(viewer: Cesium.Viewer) {
  const source = new Cesium.CustomDataSource('beam-control');
  void viewer.dataSources.add(source);
  const entities = new Map<string, Cesium.Entity>();
  let receivedAt = Date.now();

  const upsert = (id: string, live: Set<string>, create: () => Cesium.Entity.ConstructorOptions) => {
    live.add(id);
    let entity = entities.get(id);
    if (!entity) {
      entity = source.entities.add(new Cesium.Entity({ id, ...create() }));
      entities.set(id, entity);
    }
    return entity;
  };

  /** Position that keeps moving along velocity between 1 Hz snapshots. */
  const moving = (position: Vec3, velocity: Vec3) =>
    new Cesium.CallbackPositionProperty(
      () => toC3(extrapolate(position, velocity, (Date.now() - receivedAt) / 1000)),
      false,
    );

  function render(snap: WireSnapshot) {
    receivedAt = Date.now();
    const live = new Set<string>();
    const serving = new Map(snap.receivers.map((r) => [r.id, r.servingSatId]));

    for (const r of snap.receivers) {
      const e = upsert(`receiver:${r.id}`, live, () => ({
        position: Cesium.Cartesian3.fromDegrees(r.lon, r.lat),
        ellipse: {
          semiMajorAxis: 400,
          semiMinorAxis: 400,
          material: CYAN.withAlpha(0.55),
          outline: true,
          outlineColor: CYAN,
        },
        label: label('', CYAN),
      }));
      e.label!.text = new Cesium.ConstantProperty(`${r.name} receiver (SIMULATED) · ${Math.round(r.deliveredMW)} MW`);
    }

    const servingIds = new Set(serving.values());
    for (const s of snap.powerSats) {
      const e = upsert(`power-sat:${s.id}`, live, () => ({
        point: { pixelSize: 5, color: ORANGE, outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
        label: label(s.name, ORANGE, { show: false }),
      }));
      e.position = new Cesium.ConstantPositionProperty(toC3(s.position));
      e.label!.show = new Cesium.ConstantProperty(servingIds.has(s.id));
    }

    for (const b of snap.beams) {
      const e = upsert(`beam:${b.receiverId}:${b.satId}`, live, () => ({
        polyline: { arcType: Cesium.ArcType.NONE, positions: [], width: 2 },
      }));
      // Red only when power is being pulled because something is coming.
      const danger = b.state === 'throttled' || (b.state === 'ramping-down' && snap.threats.some((t) => t.satId === b.satId));
      e.polyline!.positions = new Cesium.ConstantProperty([toC3(b.from), toC3(b.to)]);
      e.polyline!.width = new Cesium.ConstantProperty(2 + 8 * b.power);
      e.polyline!.material = new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.25,
        color: (danger ? RED : ORANGE).withAlpha(0.25 + 0.75 * b.power),
      });
    }

    for (const t of snap.threats) {
      const e = upsert(`threat:${t.objectKey}:${t.satId}`, live, () => ({
        polyline: {
          arcType: Cesium.ArcType.NONE,
          width: 6,
          material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.3, color: RED }),
        },
        label: label('', RED),
      }));
      e.position = new Cesium.ConstantPositionProperty(toC3(t.position));
      e.polyline!.positions = new Cesium.ConstantProperty([toC3(t.position), toC3(t.contactPoint)]);
      e.label!.text = new Cesium.ConstantProperty(`⚠ ${t.label} · ${t.timeToContactS} s`);
    }

    for (const a of snap.aircraft) {
      const e = upsert(`aircraft:${a.id}`, live, () => ({
        billboard: {
          image: PLANE_ICON,
          width: 22,
          height: 22,
          alignedAxis: Cesium.Cartesian3.UNIT_Z,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: label(a.label, WHITE, {
          font: '500 11px system-ui, sans-serif',
          pixelOffset: new Cesium.Cartesian2(0, -16),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 250_000),
        }),
      }));
      e.position = moving(a.position, a.velocity);
      e.billboard!.rotation = new Cesium.ConstantProperty(-Cesium.Math.toRadians(a.trackDeg));
    }

    for (const d of snap.drills) {
      const e = upsert(`drill:${d.id}`, live, () => ({
        point: { pixelSize: 10, color: RED, outlineColor: WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: label(d.label, RED, { pixelOffset: new Cesium.Cartesian2(0, -16) }),
      }));
      e.position = moving(d.position, d.velocity);
    }

    for (const [id, entity] of entities) {
      if (live.has(id)) continue;
      source.entities.remove(entity);
      entities.delete(id);
    }
    viewer.scene.requestRender();
  }

  return { render };
}

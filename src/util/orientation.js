import { Cartesian3, Math as CMath, Matrix4, Transforms } from 'cesium';

const scratchEnu = new Matrix4();
const scratchLocal = new Cartesian3();

/**
 * World-space unit vector pointing along a compass heading at a given position.
 *
 * Feeding this to `billboard.alignedAxis` makes the glyph hold true heading no
 * matter where the camera is — Cesium reprojects the axis every frame, so
 * icons never spin as you orbit.
 */
export function headingVector(position, headingDeg, result = new Cartesian3()) {
  Transforms.eastNorthUpToFixedFrame(position, undefined, scratchEnu);
  const h = CMath.toRadians(headingDeg ?? 0);
  // East-north-up: x = east, y = north. Heading 0 = north, 90 = east.
  Cartesian3.fromElements(Math.sin(h), Math.cos(h), 0, scratchLocal);
  Matrix4.multiplyByPointAsVector(scratchEnu, scratchLocal, result);
  return Cartesian3.normalize(result, result);
}

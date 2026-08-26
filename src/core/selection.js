import {
  Cartesian3,
  HeadingPitchRange,
  Math as CMath,
  Matrix4,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from 'cesium';
import { bus } from './eventBus.js';
import { headingVector } from '../util/orientation.js';

export const CAMERA_MODE = { FREE: 'free', FOLLOW: 'follow', COCKPIT: 'cockpit' };

/**
 * Click-to-track. Owns three things: what is selected, whether the camera is
 * chasing it, and cleaning up after itself when the contact disappears from
 * its feed.
 */
export class SelectionController {
  constructor(viewer, registry) {
    this.viewer = viewer;
    this.registry = registry;
    this.selected = null; // { layerId, id }
    this.mode = CAMERA_MODE.FREE;
    this._handler = new ScreenSpaceEventHandler(viewer.scene.canvas);

    this._handler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position);
      const props = picked?.id?.properties;
      const trackId = props?.trackId?.getValue?.();
      const layerId = props?.layerId?.getValue?.();
      if (trackId && layerId) this.select(layerId, trackId);
      else this.clear();
    }, ScreenSpaceEventType.LEFT_CLICK);

    viewer.scene.preRender.addEventListener(() => this.#driveCamera());
  }

  get record() {
    if (!this.selected) return null;
    return this.registry.get(this.selected.layerId)?.records.get(this.selected.id) ?? null;
  }

  select(layerId, id) {
    const layer = this.registry.get(layerId);
    if (!layer?.records.has(id)) return null;
    if (this.selected) this.registry.get(this.selected.layerId)?.setSelected?.(null);
    this.selected = { layerId, id };
    layer.setSelected?.(id);
    bus.emit('selection:changed', this.record);
    return this.record;
  }

  clear() {
    if (this.selected) this.registry.get(this.selected.layerId)?.setSelected?.(null);
    this.selected = null;
    this.setMode(CAMERA_MODE.FREE);
    bus.emit('selection:changed', null);
  }

  setMode(mode) {
    if (mode !== CAMERA_MODE.FREE && !this.selected) return;
    if (this.mode !== CAMERA_MODE.FREE && mode === CAMERA_MODE.FREE) {
      // lookAt installs a reference frame; leaving it set freezes the camera.
      this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
      this.viewer.scene.screenSpaceCameraController.enableInputs = true;
    }
    this.mode = mode;
    bus.emit('camera:mode', mode);
  }

  toggleFollow() {
    this.setMode(this.mode === CAMERA_MODE.FOLLOW ? CAMERA_MODE.FREE : CAMERA_MODE.FOLLOW);
  }

  toggleCockpit() {
    this.setMode(this.mode === CAMERA_MODE.COCKPIT ? CAMERA_MODE.FREE : CAMERA_MODE.COCKPIT);
  }

  #driveCamera() {
    if (this.mode === CAMERA_MODE.FREE) return;
    const record = this.record;
    if (!record) {
      // The contact dropped out of its feed — hand control back rather than
      // leaving the camera parked on a ghost.
      this.clear();
      bus.emit('toast', { level: 'warn', text: 'Tracked contact lost — camera released' });
      return;
    }

    const p = record.positionNow?.() ?? { lat: record.lat, lon: record.lon, altM: record.altM };
    const target = Cartesian3.fromDegrees(p.lon, p.lat, p.altM);
    const { camera, scene } = this.viewer;

    if (this.mode === CAMERA_MODE.FOLLOW) {
      const heading = CMath.toRadians((record.headingNow?.() ?? record.headingDeg ?? 0) - 180);
      const range = Math.max(320, Math.min(60_000, (record.speedMps ?? 120) * 12));
      camera.lookAt(target, new HeadingPitchRange(heading, CMath.toRadians(-16), range));
      scene.screenSpaceCameraController.enableInputs = false;
      return;
    }

    // Cockpit: sit just ahead of the contact, looking along its own vector.
    const heading = record.headingNow?.() ?? record.headingDeg ?? 0;
    const forward = headingVector(target, heading);
    const eye = Cartesian3.add(target, Cartesian3.multiplyByScalar(forward, 6, new Cartesian3()), new Cartesian3());
    camera.lookAtTransform(Matrix4.IDENTITY);
    camera.setView({
      destination: eye,
      orientation: {
        direction: forward,
        // Geocentric up is orthogonal to the ENU-tangent heading vector.
        up: Cartesian3.normalize(eye, new Cartesian3()),
      },
    });
    scene.screenSpaceCameraController.enableInputs = false;
  }

  destroy() {
    this._handler.destroy();
  }
}

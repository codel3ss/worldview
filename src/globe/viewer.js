import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  Ion,
  JulianDate,
  Math as CMath,
  Rectangle,
  ScreenSpaceEventType,
  ShadowMode,
  Viewer,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

/**
 * Boots the Cesium viewer with everything we do not want stripped out later:
 * no default widget chrome, real-time clock, terrain depth testing on (so
 * ground contacts do not float through hills), and a dark space backdrop.
 */
export function createViewer(containerId, { ionToken } = {}) {
  if (ionToken) Ion.defaultAccessToken = ionToken;

  const viewer = new Viewer(containerId, {
    baseLayer: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    navigationHelpButton: false,
    baseLayerPicker: false,
    shadows: false,
    terrainShadows: ShadowMode.DISABLED,
    requestRenderMode: false,
    msaaSamples: 4,
    contextOptions: { webgl: { powerPreference: 'high-performance' } },
  });

  const { scene } = viewer;
  scene.globe.baseColor = Color.fromCssColorString('#050a10');
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.showGroundAtmosphere = true;
  scene.skyAtmosphere.show = true;
  scene.fog.enabled = true;
  scene.highDynamicRange = false;
  scene.postProcessStages.fxaa.enabled = true;
  scene.screenSpaceCameraController.enableCollisionDetection = true;
  scene.screenSpaceCameraController.minimumZoomDistance = 5;

  // The default double-click behaviour hijacks entity selection.
  viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  // Real-world time, always advancing.
  viewer.clock.shouldAnimate = true;
  viewer.clock.multiplier = 1;
  viewer.clock.currentTime = JulianDate.now();

  return viewer;
}

/** Camera height above the ellipsoid, in metres. */
export function cameraHeight(viewer) {
  const carto = viewer.camera.positionCartographic;
  return carto?.height ?? Infinity;
}

/** Geodetic position the camera is looking at, falling back to camera nadir. */
export function cameraFocus(viewer) {
  const { scene, camera } = viewer;
  const ray = camera.getPickRay(new Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2));
  const target = ray ? scene.globe.pick(ray, scene) : undefined;
  if (!target) {
    const carto = camera.positionCartographic;
    return { lat: CMath.toDegrees(carto.latitude), lon: CMath.toDegrees(carto.longitude), height: carto.height };
  }
  const carto = Cartographic.fromCartesian(target);
  return {
    lat: CMath.toDegrees(carto.latitude),
    lon: CMath.toDegrees(carto.longitude),
    height: camera.positionCartographic.height,
  };
}

/** Visible rectangle in degrees, or null when the horizon is in frame. */
export function viewRectangle(viewer) {
  const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid, new Rectangle());
  if (!rect) return null;
  return {
    minLat: CMath.toDegrees(rect.south),
    maxLat: CMath.toDegrees(rect.north),
    minLon: CMath.toDegrees(rect.west),
    maxLon: CMath.toDegrees(rect.east),
  };
}

/**
 * A search radius that tracks how much planet is on screen, clamped to what
 * the feeds will actually serve.
 */
export function viewRadiusMeters(viewer, { min = 15_000, max = 450_000 } = {}) {
  const h = cameraHeight(viewer);
  return Math.max(min, Math.min(max, h * 1.4));
}

export function flyTo(viewer, { lat, lon, height = 12_000, heading = 0, pitch = -45, duration = 2.2 }) {
  return new Promise((resolve) => {
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(lon, lat, height),
      orientation: {
        heading: CMath.toRadians(heading),
        pitch: CMath.toRadians(pitch),
        roll: 0,
      },
      duration,
      complete: resolve,
      cancel: resolve,
    });
  });
}

/** Snap the camera to a decoded share-link state, with no fly animation. */
export function applyCamera(viewer, cam) {
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(cam.lon, cam.lat, cam.height),
    orientation: {
      heading: CMath.toRadians(cam.heading),
      pitch: CMath.toRadians(cam.pitch),
      roll: 0,
    },
  });
}

import { PostProcessStage } from 'cesium';

/**
 * Sensor modes are pure colour grades applied as a single post-process pass.
 * They change how the scene reads, never what the data says.
 */

const PASSTHROUGH_HEAD = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

const NIGHT_VISION = `${PASSTHROUGH_HEAD}
uniform float u_time;
void main() {
  vec2 uv = v_textureCoordinates;
  vec3 src = texture(colorTexture, uv).rgb;
  float l = luma(src);
  // Gain up the shadows the way an image intensifier does, then clip highlights.
  float gain = pow(clamp(l * 2.6, 0.0, 1.0), 0.65);
  vec3 phosphor = vec3(0.15, 1.0, 0.42) * gain;
  // Sensor noise, scaled by how little light there is.
  float n = fract(sin(dot(uv * vec2(1271.3, 918.7) + u_time * 0.7, vec2(12.9898, 78.233))) * 43758.5453);
  phosphor += (n - 0.5) * 0.11 * (1.15 - gain);
  float r = length(uv - 0.5);
  phosphor *= smoothstep(0.78, 0.30, r);
  out_FragColor = vec4(phosphor, 1.0);
}`;

const THERMAL = `${PASSTHROUGH_HEAD}
// White-hot -> amber -> deep violet ramp, roughly a FLIR "ironbow".
vec3 ironbow(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c = vec3(0.0);
  c += vec3(0.10, 0.02, 0.28) * smoothstep(0.00, 0.28, t) * (1.0 - smoothstep(0.28, 0.52, t));
  c += vec3(0.72, 0.11, 0.36) * smoothstep(0.22, 0.52, t) * (1.0 - smoothstep(0.52, 0.74, t));
  c += vec3(1.00, 0.62, 0.08) * smoothstep(0.46, 0.76, t) * (1.0 - smoothstep(0.80, 0.95, t));
  c += vec3(1.00, 1.00, 0.93) * smoothstep(0.78, 1.00, t);
  return c;
}
void main() {
  vec3 src = texture(colorTexture, v_textureCoordinates).rgb;
  // Luminance stands in for apparent temperature. This is a look, not radiometry.
  float t = pow(luma(src), 0.78);
  out_FragColor = vec4(ironbow(t), 1.0);
}`;

const CRT = `${PASSTHROUGH_HEAD}
uniform float u_time;
uniform vec2 u_dimensions;
void main() {
  vec2 uv = v_textureCoordinates;
  // Barrel distortion around screen centre.
  vec2 c = uv - 0.5;
  c *= 1.0 + 0.055 * dot(c, c);
  uv = c + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    out_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  // Chromatic separation, strongest at the edges.
  float sep = 0.0016 * length(c);
  vec3 col = vec3(
    texture(colorTexture, uv + vec2(sep, 0.0)).r,
    texture(colorTexture, uv).g,
    texture(colorTexture, uv - vec2(sep, 0.0)).b
  );
  float scan = 0.88 + 0.12 * sin(uv.y * u_dimensions.y * 1.8 + u_time * 3.0);
  col *= scan;
  col *= smoothstep(0.92, 0.34, length(c));
  out_FragColor = vec4(col * vec3(0.86, 1.02, 0.94), 1.0);
}`;

const NOIR = `${PASSTHROUGH_HEAD}
void main() {
  vec3 src = texture(colorTexture, v_textureCoordinates).rgb;
  float l = luma(src);
  // Crush the midtones for a high-contrast monochrome plate.
  l = clamp((l - 0.5) * 1.55 + 0.46, 0.0, 1.0);
  out_FragColor = vec4(vec3(l) * vec3(0.97, 0.99, 1.05), 1.0);
}`;

export const SENSOR_MODES = [
  { id: 'normal', label: 'Normal', shader: null },
  { id: 'nightvision', label: 'Night', shader: NIGHT_VISION, uniforms: ['u_time'] },
  { id: 'thermal', label: 'Thermal', shader: THERMAL },
  { id: 'crt', label: 'CRT', shader: CRT, uniforms: ['u_time', 'u_dimensions'] },
  { id: 'noir', label: 'Noir', shader: NOIR },
];

export class SensorController {
  constructor(viewer) {
    this.viewer = viewer;
    this.current = 'normal';
    this._stage = null;
    this._start = performance.now();
  }

  apply(id) {
    const mode = SENSOR_MODES.find((m) => m.id === id);
    if (!mode) return this.current;

    if (this._stage) {
      this.viewer.scene.postProcessStages.remove(this._stage);
      this._stage = null;
    }

    if (mode.shader) {
      const uniforms = {};
      if (mode.uniforms?.includes('u_time')) {
        uniforms.u_time = () => (performance.now() - this._start) / 1000;
      }
      if (mode.uniforms?.includes('u_dimensions')) {
        const canvas = this.viewer.scene.canvas;
        uniforms.u_dimensions = () => ({ x: canvas.clientWidth, y: canvas.clientHeight });
      }
      this._stage = new PostProcessStage({ fragmentShader: mode.shader, uniforms });
      this.viewer.scene.postProcessStages.add(this._stage);
    }

    this.current = id;
    document.body.dataset.sensor = id;
    return id;
  }

  cycle() {
    const idx = SENSOR_MODES.findIndex((m) => m.id === this.current);
    return this.apply(SENSOR_MODES[(idx + 1) % SENSOR_MODES.length].id);
  }
}

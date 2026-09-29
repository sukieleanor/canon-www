import { HASH } from './common';

/**
 * Aurora curtains: up to four layered ribbons with a crisp lower edge, fine vertical rays that
 * lengthen upward, and a green → teal → violet ramp. The bass adds a travelling wave along the
 * ribbons and lifts their height. Additive; drawn over the night sky. The rays read the shared
 * noise texture, which keeps the shader small (fast to compile) and cheap per pixel.
 * uA = (time, aspect, bass, energy), uB = (phrase, layer count, chord pulse, intensity).
 */
export const AURORA_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in float vAlpha;
uniform sampler2D uNoise;
uniform vec4 uA;
uniform vec4 uB;
uniform vec3 uCol0;
uniform vec3 uCol1;
uniform vec3 uCol2;
out vec4 finalColor;
${HASH}
float rays(float x, float y) {
  return texture(uNoise, vec2(x, y) * 0.0625).b;
}
float curtain(vec2 p, float k, out float hgt) {
  float t = uA.x;
  float f = 0.5 + 0.18 * k;
  float ph = p.x * f + t * (0.03 + 0.01 * k) + k * 2.3;
  float wv = sin(ph) + 0.6 * sin(ph * 1.7 + t * 0.07 + k) + 0.3 * sin(ph * 3.3 - t * 0.12);
  wv += uA.z * 0.9 * sin(p.x * 2.0 + t * 1.5 + k * 1.3);
  float base = 0.33 + 0.07 * k + 0.085 * wv;
  float d = p.y - base;
  float edge = smoothstep(-0.006, 0.026, d);
  float H = 0.17 + 0.09 * sin(p.x * 1.1 + k * 2.0 + t * 0.045) + 0.1 * uA.w + 0.09 * uA.z + 0.05 * uB.x;
  hgt = clamp(d / (H * 1.7), 0.0, 1.0);
  float body = exp(-max(d, 0.0) / H * 2.7);
  float rx = p.x * (12.0 + 4.0 * k) + wv * 2.6;
  float ray = rays(rx, k * 7.0 + t * 0.12) * 0.62 + rays(rx * 2.7 + 3.1, t * 0.17 + k) * 0.38;
  float streak = mix(0.7, 0.2 + 1.5 * ray * ray, smoothstep(0.0, 0.12, d));
  float pulse = 0.7 + 0.3 * sin(p.x * 1.05 - t * 0.2 + k * 1.7);
  float lip = exp(-pow((d - 0.008) / 0.022, 2.0)) * 0.85;
  return (edge * body * streak + lip * (0.55 + 0.45 * ray)) * pulse;
}
void main(void) {
  vec2 p = vec2(vUV.x * uA.y, 1.0 - vUV.y);
  vec3 acc = vec3(0.0);
  int n = int(uB.y);
  for (int k = 0; k < 4; k++) {
    if (k >= n) break;
    float hgt;
    float a = curtain(p, float(k), hgt);
    vec3 c = mix(uCol0, uCol1, smoothstep(0.0, 0.5, hgt));
    c = mix(c, uCol2, smoothstep(0.42, 1.0, hgt));
    acc += c * a * (0.75 - 0.12 * float(k));
  }
  acc += uCol1 * 0.03 * exp(-abs(p.y - 0.45) * 3.0);
  acc *= uB.w * (1.0 + 0.25 * uB.z);
  float m = max(acc.r, max(acc.g, acc.b));
  vec3 col = mix(1.0 - exp(-acc * 1.5), acc / max(m, 0.0001) * (1.0 - exp(-m * 1.5)), 0.6);
  col += (hash21(gl_FragCoord.xy) - 0.5) * (1.0 / 160.0);
  col = max(col, 0.0);
  finalColor = vec4(col, max(col.r, max(col.g, col.b))) * vAlpha;
}
`;

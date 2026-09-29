import { HASH } from './common';

/**
 * Lake surface: mirrors the sky/shore render texture, bends it with layered wavelets and with the
 * ripple height field the notes stir up (R = crest, G = trough, drawn as ring sprites), and adds a
 * sun glitter path. No loops: the ripples cost three texture fetches however many there are.
 * uA = (time, aspect, swell, wind), uB = (mirror reach, mirror gain, ripple strength, unused).
 */
export const WATER_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in float vAlpha;
uniform sampler2D uSky;
uniform sampler2D uRipple;
uniform sampler2D uNoise;
uniform vec4 uA;
uniform vec4 uB;
uniform vec2 uTexel;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSunCol;
uniform vec4 uSun;
out vec4 finalColor;
${HASH}
float height(vec2 uv) {
  vec2 r = texture(uRipple, uv).rg;
  return r.x - r.y;
}
void main(void) {
  float t = uA.x;
  float asp = uA.y;
  float depth = vUV.y;
  float band = log(0.07 + depth) * 13.0;

  float w1 = sin(band * 2.1 + vUV.x * asp * 3.0 - t * 0.9);
  float w2 = sin(band * 3.7 - vUV.x * asp * 5.0 + t * 1.3 + 1.7);
  float amp = (0.0013 + 0.0026 * uA.z + 0.0012 * uA.w) * (0.3 + depth) * (0.3 + 0.7 * smoothstep(0.0, 0.3, depth));
  vec2 disp = vec2((w1 * 0.55 + w2 * 0.3) * amp * 1.8, w2 * amp * 0.25);
  float shade = w1 * 0.5 + w2 * 0.3;

  float h0 = height(vUV);
  vec2 grad = vec2(height(vUV + vec2(uTexel.x, 0.0)) - h0, height(vUV + vec2(0.0, uTexel.y)) - h0);
  disp += grad * uB.z * vec2(1.0, 0.45);
  shade += h0 * 2.0;

  float sd = depth * uB.x;
  vec2 suv = clamp(vec2(vUV.x + disp.x, 1.0 - sd + disp.y), vec2(0.002), vec2(0.998));
  vec3 refl = texture(uSky, suv).rgb;

  vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 0.9, depth));
  float mirror = mix(0.9, 0.55, smoothstep(0.0, 1.0, depth)) * uB.y;
  vec3 col = mix(body, refl * mix(vec3(1.0), uDeep * 2.6 + 0.35, 0.28), mirror);
  col += shade * 0.018 * (0.3 + depth);

  vec2 gp = vec2(vUV.x * asp * 46.0, band * 3.2 + t * 0.7) * 0.0625;
  float n = texture(uNoise, gp).b * 0.6 + texture(uNoise, gp * 2.1 + 0.37).b * 0.4;
  float spark = smoothstep(0.66, 0.92, n);
  float dx = (vUV.x - uSun.x) * asp / (uSun.z * (0.35 + depth));
  float path = exp(-dx * dx) * (1.0 - smoothstep(0.6, 1.0, depth));
  col += uSunCol * spark * path * uSun.y;
  col += uSunCol * uSun.w * exp(-depth * 22.0) * 0.35;

  col += (hash21(gl_FragCoord.xy) - 0.5) * (1.0 / 90.0);
  finalColor = vec4(col, 1.0) * vAlpha;
}
`;

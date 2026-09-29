import { FBM, HASH } from './common';

/** Gradient sky with an optional sun/moon glow and soft drifting cloud banks; dithered against banding. */
export const SKY_FRAG = `#version 300 es
in vec2 vUV;
in float vAlpha;
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uLow;
uniform vec2 uStops;
uniform vec4 uSun;
uniform vec3 uSunCol;
uniform vec4 uCloud;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uAspect;
out vec4 finalColor;
${HASH}
${FBM}
void main(void) {
  float y = vUV.y;
  vec3 col = mix(uTop, uMid, smoothstep(0.0, uStops.x, y));
  col = mix(col, uLow, smoothstep(uStops.x, uStops.y, y));

  if (uCloud.x > 0.001) {
    vec2 p = vec2(vUV.x * uAspect, vUV.y) * uCloud.z;
    p.x += uCloud.y * 0.05;
    vec2 q = p * vec2(1.0, 2.4) + vec2(0.0, 3.1);
    float n = fbm3(q);
    float n2 = uCloud.w > 0.5 ? fbm3(q + vec2(0.3, -0.12)) : n - 0.03;
    float cover = smoothstep(0.56 - 0.3 * uCloud.x, 0.86, n);
    cover *= smoothstep(uStops.y + 0.04, uStops.y - 0.32, y);
    float lit = clamp(0.55 + (n - n2) * 5.0, 0.0, 1.0);
    col = mix(col, mix(uCloudShade, uCloudLit, lit), cover * 0.8);
  }

  vec2 d = (vUV - uSun.xy) * vec2(uAspect, 1.0);
  float r2 = dot(d, d);
  float R = uSun.z;
  float R2 = R * R;
  float halo = (R2 * 12.0) / (r2 + R2 * 12.0);
  float core = R2 / (r2 + R2);
  col += uSunCol * uSun.w * (0.34 * halo * halo + 0.5 * core * core);
  float disc = smoothstep(R * 1.06, R * 0.9, sqrt(r2));
  col = mix(col, uSunCol, disc * clamp(uSun.w, 0.0, 1.0));

  col += (hash21(gl_FragCoord.xy) - 0.5) * (1.0 / 96.0);
  finalColor = vec4(col, 1.0) * vAlpha;
}
`;

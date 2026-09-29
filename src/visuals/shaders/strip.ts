/**
 * Parallax strip: a tiling silhouette texture (R = body shade, G = highlight, A = coverage) that is
 * tinted, misted toward its base and swayed by wind/bass entirely on the GPU. The rim light on the
 * edges that face the sun comes from the alpha channel: coverage minus coverage one step away.
 */
export const STRIP_FRAG = `#version 300 es
in vec2 vUV;
in float vAlpha;
uniform sampler2D uTex;
uniform vec3 uBody;
uniform vec3 uLight;
uniform vec3 uHaze;
uniform vec4 uHazeAmt;
uniform vec4 uMove;
uniform vec4 uWave;
uniform vec4 uRim;
out vec4 finalColor;
void main(void) {
  float hgt = 1.0 - vUV.y;
  float x = vUV.x;
  float sw = sin(x * uWave.x + uMove.z * uWave.y) + 0.6 * sin(x * uWave.x * 2.7 - uMove.z * uWave.y * 1.35 + 1.7);
  float bs = sin(x * uWave.x * 0.6 - uWave.w);
  float k = hgt * hgt;
  float dx = (sw * uMove.w + bs * uWave.z) * k;
  vec2 uv = vec2(x * uMove.y + uMove.x + dx, vUV.y);
  vec4 t = texture(uTex, uv);
  float rim = 0.0;
  if (uRim.z > 0.0) rim = clamp(t.a - texture(uTex, uv + uRim.xy).a, 0.0, 1.0) * uRim.z;
  vec3 col = uBody * t.r + uLight * (t.g + rim);
  float hz = mix(uHazeAmt.x, uHazeAmt.y, smoothstep(0.0, 1.0, vUV.y));
  col = mix(col, uHaze * t.a, hz);
  finalColor = vec4(col, t.a) * vAlpha;
}
`;

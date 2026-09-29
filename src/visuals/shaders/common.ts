/** GLSL shared by every custom shader (WebGL2 / GLSL ES 3.00). */

/** Vertex shader for unit-quad meshes; scale/position the Mesh to place them. */
export const QUAD_VERT = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;
out vec2 vUV;
out float vAlpha;
void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  vAlpha = uColor.a * uWorldColorAlpha.a;
}
`;

/** Cheap per-pixel hash, used for dithering. */
export const HASH = `
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

/** Smooth fractal noise from the shared noise texture: three octaves in a single fetch. */
export const FBM = `
uniform sampler2D uNoise;
float fbm3(vec2 q) {
  return dot(texture(uNoise, q * 0.25).rgb, vec3(0.5, 0.25, 0.125)) * 1.0667;
}
`;

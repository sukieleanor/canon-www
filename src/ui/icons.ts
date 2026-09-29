export type IconName =
  | 'play'
  | 'pause'
  | 'rewind'
  | 'heart'
  | 'link'
  | 'sliders'
  | 'scene'
  | 'zen'
  | 'fullscreen'
  | 'close'
  | 'record'
  | 'stop'
  | 'download'
  | 'sparkle'
  | 'trash';

/** Hand-drawn 24×24 stroke icons. */
const SHAPES: Record<IconName, string> = {
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="3"/>',
  rewind: '<path d="M11.5 7l-5 5 5 5M18.5 7l-5 5 5 5"/>',
  heart:
    '<path d="M12 20s-7.5-4.6-7.5-10.3A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  sliders:
    '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  scene: '<path d="M3 19l6.5-8.5 4 5 3-3.5L21 19z"/><circle cx="16.5" cy="7" r="2"/>',
  zen: '<path d="M12 5c-2 3-2 6 0 9 2-3 2-6 0-9z"/><path d="M12 14c-3-.4-5.8-2-7-4.5 3.2-.3 5.6 1.3 7 4.5zM12 14c3-.4 5.8-2 7-4.5-3.2-.3-5.6 1.3-7 4.5z"/><path d="M5 18h14"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  record: '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>',
  download: '<path d="M12 4v11M7 10.5l5 4.5 5-4.5M5 20h14"/>',
  sparkle:
    '<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  trash: '<path d="M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9.5 7V4.5h5V7"/>',
};

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = SHAPES[name];
  return svg;
}

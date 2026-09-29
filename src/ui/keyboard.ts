export interface ShortcutHandlers {
  togglePlay(): void;
  rewind(): void;
  nextScene(): void;
  volume(delta: number): void;
  toggleMute(): void;
  toggleFullscreen(): void;
  toggleZen(): void;
  toggleSettings(): void;
  scene(index: number): void;
  escape(): void;
}

export const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['←', 'Rewind to the previous phrase'],
  ['→', 'Next scene'],
  ['1 – 6', 'Pick a scene'],
  ['↑ / ↓', 'Volume'],
  ['M', 'Mute'],
  ['S', 'Settings'],
  ['Z', 'Zen mode'],
  ['F', 'Fullscreen'],
  ['Esc', 'Close panels / leave zen'],
];

function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return (
    target instanceof HTMLInputElement &&
    !['range', 'checkbox', 'radio', 'button'].includes(target.type)
  );
}

export function bindShortcuts(h: ShortcutHandlers): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      h.escape();
      return;
    }
    if (typingTarget(e.target)) return;
    // Buttons handle Space themselves; the global shortcut must not double-fire.
    const onButton = e.target instanceof HTMLButtonElement;
    const onRange = e.target instanceof HTMLInputElement && e.target.type === 'range';
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let handled = true;
    switch (key) {
      case ' ':
        if (onButton) return;
        h.togglePlay();
        break;
      case 'ArrowLeft':
        if (onRange) return;
        h.rewind();
        break;
      case 'ArrowRight':
        if (onRange) return;
        h.nextScene();
        break;
      case 'ArrowUp':
        if (onRange) return;
        h.volume(0.05);
        break;
      case 'ArrowDown':
        if (onRange) return;
        h.volume(-0.05);
        break;
      case 'm':
        h.toggleMute();
        break;
      case 'f':
        h.toggleFullscreen();
        break;
      case 'z':
        h.toggleZen();
        break;
      case 's':
        h.toggleSettings();
        break;
      default:
        if (/^[1-6]$/.test(key)) h.scene(Number(key) - 1);
        else handled = false;
    }
    if (handled) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

type Child = Node | string | null | undefined | false;
type AttrValue = string | number | boolean | undefined | null | ((event: never) => void);

/** Tiny element builder: h('button', { class: 'btn', onClick: fn }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      el.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
    } else if (name === 'class') {
      el.className = String(value);
    } else {
      el.setAttribute(name, value === true ? '' : String(value));
    }
  }
  for (const child of children)
    if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}

export function clearChildren(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

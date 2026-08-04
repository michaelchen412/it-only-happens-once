// A minimal, accessible tab strip for the editor sheets: [data-tab="<key>"]
// buttons switch [data-tabpanel="<key>"] panels within the same root.
// Roving arrow keys + Home/End, per the WAI-ARIA tabs pattern.

export interface TabsHandle {
  /** Show a panel programmatically (e.g. reset to the content tab on open). */
  select: (key: string) => void;
  current: () => string;
}

export function wireSheetTabs(root: ParentNode, onSelect?: (key: string) => void): TabsHandle {
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-tab]'));
  const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-tabpanel]'));

  function select(key: string) {
    tabs.forEach((t) => {
      const on = t.dataset.tab === key;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1; // roving tabindex: one stop for the whole strip
    });
    panels.forEach((p) => (p.hidden = p.dataset.tabpanel !== key));
    onSelect?.(key);
  }

  tabs.forEach((t) => t.addEventListener('click', () => select(t.dataset.tab!)));

  root.addEventListener('keydown', (e) => {
    const ev = e as KeyboardEvent;
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i === -1) return;
    const to =
      ev.key === 'ArrowRight'
        ? (i + 1) % tabs.length
        : ev.key === 'ArrowLeft'
          ? (i - 1 + tabs.length) % tabs.length
          : ev.key === 'Home'
            ? 0
            : ev.key === 'End'
              ? tabs.length - 1
              : -1;
    if (to === -1) return;
    ev.preventDefault();
    tabs[to].focus();
    select(tabs[to].dataset.tab!);
  });

  return { select, current: () => tabs.find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.tab ?? '' };
}

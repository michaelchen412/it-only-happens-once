import { cloneIcon } from './icon';

if (!customElements.get('entity-combo')) {
  let uid = 0;
  interface Opt {
    id: string;
    name: string;
    authorId?: string | null;
  }
  type Row = { create?: boolean; opt?: Opt; name: string };

  /**
   * How many rows the menu will draw (docs/plans/16 · Piece 2).
   *
   * It was 50, silently, against 70 authors — so focusing the field showed
   * you 50 and said nothing about the other 20. The list simply ended, which
   * teaches you it is complete when it isn't. The number is not the fault;
   * the SILENCE is, which is why raising it comes with `__more` below.
   *
   * 200 is chosen to sit comfortably above the corpus rather than to be a
   * real limit: rendering menu rows is the CHEAP half of this control (the
   * expensive half — shipping every author and work into a `data-options`
   * attribute on every page that mounts a sheet — is still unbounded, and
   * that inversion is what step 2 of the plan exists to fix). Revisit at a
   * few hundred rows, or the first time a name is hard to find by typing.
   */
  const MAX_ROWS = 200;

  /**
   * Accent-insensitive search key. `includes()` on a lowercased string meant
   * "Marquez" could not find "Márquez" — a real failure in a corpus of
   * quotations, where you type the name you remember rather than the one with
   * the diacritics you'd have to go and look up.
   *
   * FOLDING IS FOR FINDING, NOT FOR IDENTITY. `commitFromText` and the
   * exact-match test below deliberately still compare unfolded: this
   * component's contract is that you either pick something that exists or
   * EXPLICITLY choose "＋ Add", and folding identity would quietly make
   * "Marquez" un-creatable next to "Márquez". Ranking the real match first is
   * enough — you can see it and pick it.
   */
  const fold = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();

  class EntityCombo extends HTMLElement {
    options: Opt[] = [];
    selected: Opt | null = null;
    rows: Row[] = [];
    activeIndex = -1;
    open = false;
    noun = 'item';
    baseId = '';
    field!: HTMLInputElement;
    idInput!: HTMLInputElement;
    nameInput!: HTMLInputElement;
    menu!: HTMLUListElement;
    clearBtn!: HTMLButtonElement;

    connectedCallback() {
      const name = this.dataset.name || 'entity';
      const idName = this.dataset.idName || 'entity_id';
      this.noun = this.dataset.noun || 'item';
      this.options = JSON.parse(this.dataset.options || '[]');
      this.baseId = `combo-${++uid}`;
      this.innerHTML = '';

      this.field = document.createElement('input');
      this.field.type = 'text';
      this.field.className = 'entity-combo__field input input-sm input-bordered w-full';
      this.field.placeholder = this.dataset.placeholder || '';
      this.field.autocomplete = 'off';
      this.field.setAttribute('role', 'combobox');
      this.field.setAttribute('aria-autocomplete', 'list');
      this.field.setAttribute('aria-expanded', 'false');
      this.field.setAttribute('aria-controls', `${this.baseId}-menu`);
      this.field.setAttribute('aria-label', this.dataset.label || this.noun);

      this.clearBtn = document.createElement('button');
      this.clearBtn.type = 'button';
      this.clearBtn.className = 'entity-combo__clear';
      this.clearBtn.textContent = '✕';
      this.clearBtn.tabIndex = -1;
      this.clearBtn.hidden = true;
      this.clearBtn.setAttribute('aria-label', `Clear ${this.noun}`);

      this.menu = document.createElement('ul');
      this.menu.className = 'entity-combo__menu';
      this.menu.id = `${this.baseId}-menu`;
      this.menu.setAttribute('role', 'listbox');
      this.menu.hidden = true;

      this.idInput = document.createElement('input');
      this.idInput.type = 'hidden';
      this.idInput.name = idName;
      this.nameInput = document.createElement('input');
      this.nameInput.type = 'hidden';
      this.nameInput.name = name;

      this.append(this.field, this.clearBtn, this.menu, this.idInput, this.nameInput);

      this.field.addEventListener('input', () => this.onInput());
      this.field.addEventListener('focus', () => this.openMenu());
      this.field.addEventListener('keydown', (e) => this.onKeydown(e));
      this.field.addEventListener('blur', () => this.onBlur());
      this.clearBtn.addEventListener('click', () => {
        this.clear();
        this.emit();
        this.field.focus();
      });
      // Keep focus on the field when a row is clicked, so blur doesn't fire first.
      this.menu.addEventListener('mousedown', (e) => e.preventDefault());
    }

    // --- menu rendering ---
    /**
     * Matches, best first, plus how many were left out.
     *
     * Ranking: names that START with what you typed come before names that
     * merely contain it. Typing "mar" used to put every substring hit ahead
     * of nothing in particular — "Amartya Sen" above "Marcus Aurelius" — so
     * the top row, which is what Enter takes, was arbitrary.
     */
    private filterOptions(text: string): { list: Opt[]; more: number } {
      const q = fold(text.trim());
      if (!q) {
        return { list: this.options.slice(0, MAX_ROWS), more: Math.max(0, this.options.length - MAX_ROWS) };
      }
      const starts: Opt[] = [];
      const contains: Opt[] = [];
      for (const o of this.options) {
        const at = fold(o.name).indexOf(q);
        if (at === 0) starts.push(o);
        else if (at > 0) contains.push(o);
      }
      const all = starts.concat(contains);
      return { list: all.slice(0, MAX_ROWS), more: Math.max(0, all.length - MAX_ROWS) };
    }
    private renderMenu() {
      const text = this.field.value;
      const q = text.trim();
      const exact = !!q && this.options.some((o) => o.name.toLowerCase() === q.toLowerCase());
      const { list, more } = this.filterOptions(text);
      this.rows = list.map((o) => ({ opt: o, name: o.name }));
      if (q && !exact) this.rows.push({ create: true, name: q });

      this.menu.innerHTML = '';
      if (!this.rows.length) {
        this.menu.hidden = true;
        this.field.setAttribute('aria-expanded', 'false');
        this.field.removeAttribute('aria-activedescendant');
        return;
      }
      this.activeIndex = Math.max(0, Math.min(this.activeIndex, this.rows.length - 1));
      this.rows.forEach((row, i) => {
        // The truncation notice goes BEFORE "＋ Add", never after: if the list
        // is cut short, the thing you're looking for may be in the part you
        // can't see, and offering to create a second copy of it first is the
        // wrong order to ask the two questions in.
        if (row.create && more > 0) this.menu.appendChild(this.moreRow(more));
        const li = document.createElement('li');
        li.id = `${this.baseId}-opt-${i}`;
        li.className = 'entity-combo__opt';
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === this.activeIndex));
        if (i === this.activeIndex) li.classList.add('is-active');
        if (row.create) {
          li.classList.add('entity-combo__opt--create');
          // ⚠ `ph:plus`, NOT THE `＋` CHARACTER (plan 42 · §4.B.5) — and this
          // slot gave no reason to keep it: `.entity-combo__plus` is one margin
          // rule, not geometry tuned to a glyph the way `.cn-cell__mark` is. It
          // is CLONED rather than `<Icon>`d because this menu is built in the
          // browser; the source is the hidden span in `EntityCombo.astro`.
          const plus = document.createElement('span');
          plus.className = 'entity-combo__plus';
          const glyph = cloneIcon('ph:plus');
          if (glyph) plus.appendChild(glyph);
          const b = document.createElement('b');
          b.textContent = row.name;
          li.append(plus, document.createTextNode(` Add ${this.noun} “`), b, document.createTextNode('”'));
        } else {
          li.textContent = row.name;
        }
        li.addEventListener('click', () => this.pick(i));
        this.menu.appendChild(li);
      });
      // No create row to sit above (an exact match was typed, or the field is
      // empty) — the notice still has to be said, so it lands at the foot.
      if (more > 0 && !this.menu.querySelector('.entity-combo__more')) {
        this.menu.appendChild(this.moreRow(more));
      }
      this.menu.hidden = false;
      this.field.setAttribute('aria-expanded', 'true');
      this.field.setAttribute('aria-activedescendant', `${this.baseId}-opt-${this.activeIndex}`);
    }
    /**
     * "42 more — keep typing to narrow this down."
     *
     * A cap is defensible; a cap that doesn't admit it is not. This row is
     * the whole point of the piece: the menu used to just END, and a list
     * that ends looks exactly like a list that is complete. Not a member of
     * `this.rows`, so it is never the active descendant and Enter can never
     * land on it — but it IS `role="option"`, so a screen reader arrowing to
     * the bottom hears it too rather than only sighted users seeing it.
     */
    private moreRow(n: number): HTMLLIElement {
      const li = document.createElement('li');
      li.className = 'entity-combo__more';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-disabled', 'true');
      li.setAttribute('aria-selected', 'false');
      li.textContent = `${n.toLocaleString()} more — keep typing to narrow this down`;
      return li;
    }
    private openMenu() {
      this.open = true;
      this.activeIndex = 0;
      this.renderMenu();
    }
    private closeMenu() {
      this.open = false;
      this.menu.hidden = true;
      this.field.setAttribute('aria-expanded', 'false');
      this.field.removeAttribute('aria-activedescendant');
    }

    // --- user interaction ---
    private onInput() {
      // Typing breaks any existing id link; the tentative value is a create-by-name.
      this.idInput.value = '';
      this.nameInput.value = this.field.value.trim();
      this.selected = null;
      this.updateClear();
      this.activeIndex = 0;
      this.openMenu();
    }
    private onKeydown(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!this.open) this.openMenu();
        else {
          this.activeIndex = Math.min(this.activeIndex + 1, this.rows.length - 1);
          this.renderMenu();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.activeIndex = Math.max(this.activeIndex - 1, 0);
        this.renderMenu();
      } else if (e.key === 'Enter') {
        e.preventDefault(); // never let it submit the form implicitly
        if (this.open && this.activeIndex >= 0 && this.rows.length) this.pick(this.activeIndex);
        else this.commitFromText();
        this.closeMenu();
      } else if (e.key === 'Escape') {
        if (this.open) {
          e.preventDefault();
          this.closeMenu();
        }
      }
    }
    private onBlur() {
      this.commitFromText();
      this.closeMenu();
    }
    private pick(i: number) {
      const row = this.rows[i];
      if (!row) return;
      if (row.create) this.commit('', row.name, null);
      else this.commit(row.opt!.id, row.opt!.name, row.opt!);
      this.closeMenu();
      this.emit();
    }
    private commitFromText() {
      const text = this.field.value.trim();
      const before = `${this.idInput.value}�${this.nameInput.value}`;
      if (!text) {
        this.commit('', '', null);
      } else {
        const match = this.options.find((o) => o.name.toLowerCase() === text.toLowerCase());
        if (match) this.commit(match.id, match.name, match);
        else this.commit('', text, null);
      }
      if (`${this.idInput.value}�${this.nameInput.value}` !== before) this.emit();
    }
    private commit(id: string, name: string, opt: Opt | null) {
      this.idInput.value = id;
      this.nameInput.value = name;
      this.field.value = name;
      this.selected = opt;
      this.updateClear();
    }
    private updateClear() {
      this.clearBtn.hidden = !this.field.value;
    }

    // --- public API (programmatic; never emits `combo:change`) ---
    setValue(id?: string | null, name?: string | null) {
      const n = (name ?? '').trim();
      if (id) {
        const opt = this.options.find((o) => o.id === id) ?? { id, name: n };
        this.commit(id, opt.name || n, opt);
      } else if (n) {
        const match = this.options.find((o) => o.name.toLowerCase() === n.toLowerCase());
        if (match) this.commit(match.id, match.name, match);
        else this.commit('', n, null);
      } else {
        this.commit('', '', null);
      }
    }
    clear() {
      this.commit('', '', null);
    }
    getId() {
      return this.idInput.value;
    }
    getName() {
      return this.nameInput.value;
    }
    getOption(): Opt | null {
      return this.selected;
    }
    setOptions(list: Opt[]) {
      this.options = Array.isArray(list) ? list : [];
      if (this.open) this.renderMenu();
    }

    private emit() {
      this.dispatchEvent(
        new CustomEvent('combo:change', {
          detail: { id: this.getId(), name: this.getName(), option: this.selected },
          bubbles: true,
        }),
      );
    }
  }
  customElements.define('entity-combo', EntityCombo);
}

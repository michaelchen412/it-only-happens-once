// <subject-filter> — a searchable, multi-select combobox for filtering by
// subject (AND semantics). A hidden <input name="subject"> holds comma-joined
// slugs; changes dispatch a bubbling `filter:change` event.
//
// The definition lives here (not inline in SubjectFilter.astro) so pages that
// receive the element via a fetched partial — the fragment browser sheet — can
// import it too; Astro partials strip component scripts.

interface Opt {
  name: string;
  slug: string;
}

if (!customElements.get('subject-filter')) {
  let cid = 0;
  class SubjectFilter extends HTMLElement {
    opts: Opt[] = [];
    selected: string[] = [];
    hiddenInput!: HTMLInputElement;
    field!: HTMLInputElement;
    listbox!: HTMLElement;
    live!: HTMLElement;
    active = -1;
    uid = `sf-${++cid}`;

    connectedCallback() {
      this.opts = JSON.parse(this.dataset.options || '[]');
      this.selected = (this.dataset.value || '').split(',').map((s) => s.trim()).filter(Boolean);
      this.innerHTML = '';

      this.hiddenInput = document.createElement('input');
      this.hiddenInput.type = 'hidden';
      this.hiddenInput.name = 'subject';

      this.field = document.createElement('input');
      this.field.type = 'text';
      this.field.className = 'subject-filter__field';
      this.field.placeholder = 'Subjects…';
      this.field.setAttribute('role', 'combobox');
      this.field.setAttribute('aria-expanded', 'false');
      this.field.setAttribute('aria-autocomplete', 'list');
      this.field.setAttribute('aria-label', 'Filter by subject');
      this.field.setAttribute('aria-controls', `${this.uid}-list`);
      this.field.autocomplete = 'off';

      this.listbox = document.createElement('ul');
      this.listbox.id = `${this.uid}-list`;
      this.listbox.className = 'subject-filter__list';
      this.listbox.setAttribute('role', 'listbox');
      this.listbox.hidden = true;

      this.live = document.createElement('span');
      this.live.className = 'sr-only';
      this.live.setAttribute('aria-live', 'polite');

      this.append(this.hiddenInput, this.field, this.listbox, this.live);

      this.field.addEventListener('input', () => this.openList());
      this.field.addEventListener('focus', () => this.openList());
      this.field.addEventListener('keydown', (e) => this.onKey(e));
      this.addEventListener('mousedown', (e) => {
        if (e.target === this) {
          e.preventDefault();
          this.field.focus();
        }
      });
      document.addEventListener('click', (e) => {
        if (!this.contains(e.target as Node)) this.closeList();
      });

      this.renderChips();
    }

    filtered(): Opt[] {
      const qy = this.field.value.trim().toLowerCase();
      // no cap — the list scrolls (max-height + overflow in app.css)
      return this.opts.filter((o) => !this.selected.includes(o.slug) && o.name.toLowerCase().includes(qy));
    }

    openList() {
      const items = this.filtered();
      this.listbox.innerHTML = '';
      this.active = -1;
      this.field.removeAttribute('aria-activedescendant');
      if (!items.length) {
        this.closeList();
        return;
      }
      items.forEach((o, i) => {
        const li = document.createElement('li');
        li.id = `${this.uid}-opt-${i}`;
        li.className = 'subject-filter__opt';
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.dataset.slug = o.slug;
        li.textContent = o.name;
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this.add(o.slug);
        });
        this.listbox.appendChild(li);
      });
      this.listbox.hidden = false;
      this.field.setAttribute('aria-expanded', 'true');
    }
    closeList() {
      this.listbox.hidden = true;
      this.active = -1;
      this.field.setAttribute('aria-expanded', 'false');
      this.field.removeAttribute('aria-activedescendant');
    }

    onKey(e: KeyboardEvent) {
      const items = Array.from(this.listbox.querySelectorAll<HTMLElement>('.subject-filter__opt'));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.listbox.hidden) return this.openList();
        this.active = Math.min(this.active + 1, items.length - 1);
        this.paintActive(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.active = Math.max(this.active - 1, 0);
        this.paintActive(items);
      } else if (e.key === 'Enter') {
        if (!this.listbox.hidden && items.length) {
          e.preventDefault();
          this.add((items[this.active] ?? items[0]).dataset.slug!);
        }
      } else if (e.key === 'Escape') {
        this.closeList();
      } else if (e.key === 'Backspace' && this.field.value === '' && this.selected.length) {
        this.selected.pop();
        this.commit();
      }
    }
    paintActive(items: HTMLElement[]) {
      items.forEach((li, i) => {
        const on = i === this.active;
        li.classList.toggle('is-active', on);
        li.setAttribute('aria-selected', String(on));
      });
      const cur = items[this.active];
      if (cur) {
        this.field.setAttribute('aria-activedescendant', cur.id);
        cur.scrollIntoView({ block: 'nearest' });
      } else {
        this.field.removeAttribute('aria-activedescendant');
      }
    }

    nameOf(slug: string) {
      return this.opts.find((o) => o.slug === slug)?.name ?? slug;
    }
    announce(msg: string) {
      if (this.live) this.live.textContent = msg;
    }

    add(slug: string) {
      if (!this.selected.includes(slug)) {
        this.selected.push(slug);
        this.announce(`Added ${this.nameOf(slug)}`);
      }
      this.field.value = '';
      this.closeList();
      this.commit();
      this.field.focus();
    }
    removeSlug(slug: string) {
      this.announce(`Removed ${this.nameOf(slug)}`);
      this.selected = this.selected.filter((s) => s !== slug);
      this.commit();
    }

    /** Public: drop every selection (the toolbar's "clear" button). */
    clear() {
      if (!this.selected.length && !this.field.value) return;
      this.selected = [];
      this.field.value = '';
      this.commit();
    }

    commit() {
      this.renderChips();
      this.hiddenInput.value = this.selected.join(',');
      this.dispatchEvent(new Event('filter:change', { bubbles: true }));
    }

    renderChips() {
      this.querySelectorAll('.subject-filter__chip').forEach((c) => c.remove());
      this.selected.forEach((slug) => {
        const name = this.opts.find((o) => o.slug === slug)?.name ?? slug;
        const chip = document.createElement('span');
        chip.className = 'subject-filter__chip';
        chip.textContent = name;
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'subject-filter__x';
        x.setAttribute('aria-label', `Remove ${name}`);
        x.textContent = '✕';
        x.addEventListener('click', () => this.removeSlug(slug));
        chip.appendChild(x);
        this.insertBefore(chip, this.field);
      });
    }
  }
  customElements.define('subject-filter', SubjectFilter);
}

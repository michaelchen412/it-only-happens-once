// The theme toggle — dusk ⇄ paper, once, for both chromes.
//
// WHY THIS FILE EXISTS. It was implemented twice, and the two copies disagreed.
// `AdminLayout` had a `syncThemeBtn()` and called it on load, so the
// Observatory's button carried a correct `aria-pressed`. `SiteLayout` set
// `aria-pressed` only INSIDE its click handler — so on the public site the
// attribute was absent until you pressed it, and absent again after every view
// transition replaced the DOM. Same control, same two themes, two
// implementations, one of them right.
//
// Mounted from `Base.astro`, which is where the no-flash picker in <head>
// already lives — so the two halves of "what theme is this" sit in one file
// rather than in three.
//
// ⚠ DELEGATED ON `document`, NOT BOUND TO THE BUTTON. The public site navigates
// with the View Transitions router, which replaces the whole body: a listener
// bound to the element would be attached to a button that no longer exists
// after the first navigation. This is also why `sync()` runs again on
// `astro:page-load` — the incoming page's button is a different element and
// arrives with whatever `aria-pressed` the server rendered, which is nothing.
const KEY = 'theme';
type Theme = 'dusk' | 'paper';

const current = (): Theme => (document.documentElement.dataset.theme === 'paper' ? 'paper' : 'dusk');

/** Tell the button which way it is pointing. `paper` is the pressed state:
 *  dusk is the default, so "pressed" reads as "you turned the light on". */
function sync(): void {
  document.getElementById('theme-toggle')?.setAttribute('aria-pressed', String(current() === 'paper'));
}

function apply(next: Theme): void {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode — the theme still applies for this page's lifetime */
  }
  sync();
}

document.addEventListener('click', (e) => {
  if (!(e.target as Element)?.closest?.('#theme-toggle')) return;
  apply(current() === 'paper' ? 'dusk' : 'paper');
});

// Other tabs. `storage` fires only in the tabs that did NOT write, which is
// exactly the ones that need telling.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY || (e.newValue !== 'dusk' && e.newValue !== 'paper')) return;
  document.documentElement.dataset.theme = e.newValue;
  sync();
});

sync();
document.addEventListener('astro:page-load', sync);

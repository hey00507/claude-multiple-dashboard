const btnTheme = document.getElementById('btn-theme');

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function getCurrentTheme() {
  return localStorage.getItem('claude-dash-theme') || 'system';
}

function applyTheme() {
  const pref = getCurrentTheme();
  const effective = pref === 'system' ? getSystemTheme() : pref;
  if (pref === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', effective);
  }
  btnTheme.textContent = effective === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
  btnTheme.title = pref === 'system' ? `테마: 시스템 (${effective})` : `테마: ${effective}`;
}

btnTheme.addEventListener('click', () => {
  const current = getCurrentTheme();
  const effective = current === 'system' ? getSystemTheme() : current;
  const next = effective === 'dark' ? 'light' : 'dark';
  localStorage.setItem('claude-dash-theme', next);
  applyTheme();
  // Update terminal theme if loaded
  try {
    import('./terminal.js').then(m => m.updateTerminalTheme()).catch(() => {});
  } catch {}
});

window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (getCurrentTheme() === 'system') applyTheme();
});

applyTheme();

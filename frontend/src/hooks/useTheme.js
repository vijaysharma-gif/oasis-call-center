import { useState, useEffect } from 'react';

export function useTheme() {
  const [theme, setThemeState] = useState(
    () => localStorage.getItem('theme') || 'system'
  );

  useEffect(() => {
    const root = document.documentElement;

    function apply(t) {
      if (t === 'dark') {
        root.classList.add('dark');
      } else if (t === 'light') {
        root.classList.remove('dark');
      } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.toggle('dark', prefersDark);
      }
    }

    apply(theme);
    localStorage.setItem('theme', theme);

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => apply('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme]);

  function setTheme(t) { setThemeState(t); }

  return { theme, setTheme };
}

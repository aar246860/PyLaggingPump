const prefersDark = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

function setTheme(mode) {
  const html = document.documentElement;
  if (mode === 'dark') {
    html.classList.add('dark');
    html.setAttribute('data-theme', 'dark');
  } else {
    html.classList.remove('dark');
    html.setAttribute('data-theme', 'light');
  }
  const toggle = document.getElementById('themeToggle');
  if (toggle) {
    const isDark = html.classList.contains('dark');
    toggle.setAttribute('aria-pressed', String(isDark));
    toggle.textContent = isDark ? 'Switch to light' : 'Switch to dark';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const tocList = document.querySelector('#tocList');
  const headings = Array.from(document.querySelectorAll('article h2'));
  headings.forEach((heading) => {
    const section = heading.closest('section');
    const slugBase = heading.textContent.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-');
    const slug = section?.id || heading.id || slugBase;
    if (section && !section.id) {
      section.id = slug;
    }
    if (!heading.id) {
      heading.id = slug;
    }
  });

  if (tocList) {
    tocList.innerHTML = headings
      .map((heading) => {
        const slug = heading.id;
        return `<li><a class="block rounded-lg px-3 py-1.5 text-zinc-400 transition hover:text-white" href="#${slug}">${heading.textContent}</a></li>`;
      })
      .join('');
  }

  const sections = document.querySelectorAll('.doc-section');
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle('visible', entry.isIntersecting);
      });
    },
    { rootMargin: '-10% 0px -10% 0px' }
  );
  sections.forEach((section) => {
    section.classList.add('reveal');
    revealObserver.observe(section);
  });

  const tocLinks = tocList ? Array.from(tocList.querySelectorAll('a')) : [];
  let activeId = null;

  function setActive(id) {
    if (!id || activeId === id) return;
    activeId = id;
    tocLinks.forEach((link) => {
      const isActive = link.getAttribute('href') === `#${id}`;
      link.classList.toggle('text-white', isActive);
      link.classList.toggle('bg-white/5', isActive);
      link.classList.toggle('font-semibold', isActive);
    });
  }

  const spyObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visible.length > 0) {
        setActive(visible[0].target.id);
      } else {
        entries.forEach((entry) => {
          if (entry.boundingClientRect.top >= 0) {
            setActive(entry.target.id);
          }
        });
      }
    },
    { rootMargin: '-40% 0px -50% 0px', threshold: [0.1, 0.25, 0.5] }
  );
  sections.forEach((section) => spyObserver.observe(section));
  setActive(sections[0]?.id);

  const storedTheme = localStorage.getItem('theme');
  if (storedTheme) {
    setTheme(storedTheme);
  } else if (prefersDark?.matches) {
    setTheme('dark');
  } else {
    setTheme('light');
  }

  const themeToggle = document.getElementById('themeToggle');
  themeToggle?.addEventListener('click', () => {
    const html = document.documentElement;
    const nextTheme = html.classList.contains('dark') ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('theme', nextTheme);
  });

  const handlePrefChange = (event) => {
    if (!localStorage.getItem('theme')) {
      setTheme(event.matches ? 'dark' : 'light');
    }
  };
  if (prefersDark?.addEventListener) {
    prefersDark.addEventListener('change', handlePrefChange);
  } else if (prefersDark?.addListener) {
    prefersDark.addListener(handlePrefChange);
  }

  if (window.MathJax?.typesetPromise) {
    try {
      await window.MathJax.typesetPromise();
    } catch (err) {
      console.error('MathJax typeset failed', err);
    }
  }
});

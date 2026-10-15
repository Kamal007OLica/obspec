const svg = (body: string, vb = '0 0 16 16') => `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  logo: `<svg class="logo" viewBox="0 0 20 20" aria-hidden="true"><defs><linearGradient id="obg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8B74FF"/><stop offset="1" stop-color="#5B3FD6"/></linearGradient></defs><rect width="20" height="20" rx="6" fill="url(#obg)"/><path d="M6 6.5h8M6 10h5.5M6 13.5h7" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><circle cx="14.5" cy="13.5" r="1.4" fill="#fff"/></svg>`,
  search: svg('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>'),
  back: svg('<path d="M10 3 5 8l5 5"/>'),
  gear: svg('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>'),
  external: svg('<path d="M6.5 3.5H3.5v9h9v-3M9 3.5h3.5V7M12.5 3.5 7.5 8.5"/>'),
  link: svg('<path d="M6.5 9.5 9.5 6.5M5 7 3.6 8.4a2.5 2.5 0 0 0 3.5 3.5L8.6 10.5M11 9l1.4-1.4a2.5 2.5 0 0 0-3.5-3.5L7.4 5.5"/>'),
  unlink: svg('<path d="M5 7 3.6 8.4a2.5 2.5 0 0 0 3.5 3.5L8.6 10.5M11 9l1.4-1.4a2.5 2.5 0 0 0-3.5-3.5L7.4 5.5M3 3l10 10"/>'),
  card: svg('<rect x="2.5" y="3" width="11" height="10" rx="2"/><path d="M5 6.5h6M5 9h4"/>'),
  pull: svg('<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>'),
  push: svg('<path d="M8 13.5v-8M4.5 9 8 5.5 11.5 9M3 2.5h10"/>'),
  frame: svg('<path d="M5 2v12M11 2v12M2 5h12M2 11h12"/>'),
  text: svg('<path d="M3.5 4V3h9v1M8 3v10M6 13h4"/>'),
  component: svg('<path d="m8 2 2.2 2.2L8 6.4 5.8 4.2zM11.8 5.8 14 8l-2.2 2.2L9.6 8zM4.2 5.8 6.4 8l-2.2 2.2L2 8zM8 9.6l2.2 2.2L8 14l-2.2-2.2z"/>'),
  layer: svg('<path d="m8 2.5 5.5 3L8 8.5l-5.5-3zM2.5 8.5 8 11.5l5.5-3M2.5 11 8 14l5.5-3"/>'),
  page: svg('<path d="M4 2.5h5l3 3v8H4z"/><path d="M9 2.5v3h3"/>'),
  note: svg('<path d="M4 2.5h8v11H4z"/><path d="M6 6h4M6 8.5h4M6 11h2"/>'),
  check: svg('<path d="m3.5 8.5 3 3 6-7"/>'),
  plus: svg('<path d="M8 3v10M3 8h10"/>'),
  refresh: svg('<path d="M13 8a5 5 0 0 1-8.6 3.5M3 8a5 5 0 0 1 8.6-3.5M11.5 2v2.7H8.8M4.5 14v-2.7h2.7"/>'),
  wifiOff: svg('<path d="M2 6.5a9 9 0 0 1 12 0M4.5 9a5.5 5.5 0 0 1 7 0M7 11.5a2 2 0 0 1 2 0M2 2l12 12"/>'),
  empty: svg('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3M5.5 7h3"/>'),
  select: svg('<path d="M3 3l4.5 10 1.5-4 4-1.5z"/>'),
  close: svg('<path d="m4 4 8 8M12 4l-8 8"/>'),
};

export function nodeIcon(type: string): string {
  switch (type) {
    case 'TEXT': return icons.text;
    case 'COMPONENT': case 'COMPONENT_SET': case 'INSTANCE': return icons.component;
    case 'FRAME': case 'SECTION': return icons.frame;
    case 'PAGE': return icons.page;
    default: return icons.layer;
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/* Shared line icons for interface controls; uploaded link icons stay intact. */
(() => {
  const paths={
    menu:'M4 6h16M4 12h16M4 18h16',
    resize:'M8 20 20 8M14 20l6-6M19 20l1-1',
    image:'M3 3h18v18H3zM3 16l6-6 5 5 3-3 4 4M17 7h.01',
    calendar:'M4 5h16v16H4zM8 3v4M16 3v4M4 10h16M8 14h2M14 14h2',
    users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M18 8a3 3 0 0 1 0 6M22 21v-2a4 4 0 0 0-3-3.9',
    key:'M15 9a6 6 0 1 1-6-6 6 6 0 0 1 6 6ZM13.3 13.3 21 21M17 17l3-3M19 19l3-3',
    mail:'M3 5h18v14H3zM3 5l9 8 9-8',
    edit:'M12 20H4v-8M16 3l5 5-11 11-6 1 1-6ZM14 5l5 5',
    network:'M8 3h8v6H8zM2 17h6v4H2zM16 17h6v4h-6zM12 9v4M5 17v-4h14v4',
    shield:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6ZM8 12l3 3 5-6',
    info:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 11v6M12 7h.01',
    link:'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
    group:'M3 5h7l2 2h9v13H3z',
    document:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
    history:'M3 11a9 9 0 1 1 2.8 7M3 4v7h7M12 7v5l3 2',
    settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    lock:'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',
    sun:'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    moon:'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8',
    cloud:'M6 18a4 4 0 1 1 .6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1 0 9Z',
    rain:'M5 14a3.5 3.5 0 1 1 1-7 6 6 0 0 1 11.5 1A3.5 3.5 0 0 1 19 15M8 17l-1 4M13 17l-1 4M18 17l-1 4',
    snow:'M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M8 4l4 3 4-3M8 20l4-3 4 3M3 11l4-2-1-5M21 13l-4 2 1 5M3 13l4 2-1 5M21 11l-4-2 1-5',
    storm:'M5 14a3.5 3.5 0 1 1 1-7 6 6 0 0 1 11.5 1A3.5 3.5 0 0 1 19 15M13 13l-4 5h5l-3 5',
    fog:'M4 9h16M2 13h20M4 17h16',
  };
  window.LinkPageIcons={svg(name,size=16){return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.link}"/></svg>`;}};
})();

import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
const query = (name) => {
  const hit = APP.match(new RegExp(`const ${name} = matchMedia\\('\\(max-width: (\\d+)px\\)'\\)`));
  if (!hit) throw new Error(`public/app.js no longer declares the ${name} media query`);
  return Number(hit[1]);
};

export const PHONE_MAX = query('dockCoversScreen');
export const DESKTOP_MIN = PHONE_MAX + 1;
export const TRAY_HIDDEN_MAX = query('tightShell');
export const TRAY_SHOWN_MIN = TRAY_HIDDEN_MAX + 1;

export const WIDTH = {
  phone: 390,
  halfLaptop: 756,
  widestPhoneFormat: PHONE_MAX,
  narrowestDesktop: DESKTOP_MIN,
  widestTrayHidden: TRAY_HIDDEN_MAX,
  narrowestTrayShown: TRAY_SHOWN_MIN,
  desktop: 1440,
};

export const showTray = (page) => page.locator('.view-header .nav-menu >> visible=true').first().click();

// Images for the home page, cut from the approved mockup (design/home-mockup.png) by
// tools/extract_home_images.py. Printed texts were removed from them; the app draws the texts
// itself (Hindi / English, clickable). Set any value to null to fall back to the coded illustration.
const I = name => `/img/home/${name}.jpg`;
export const HOME_IMAGES = {
  hero: I('hero'),
  heroHasText: true,   // the hero photo already shows the logo, "Alfrzo Ilm" and the quote
  scholar: null,       // the scholar is part of the hero photo
  cities: { bengaluru: I('city-bengaluru'), hyderabad: I('city-hyderabad'), pune: I('city-pune'), mumbai: I('city-mumbai') },
  tiles: { quran: I('tile-quran'), hadith: I('tile-hadith'), fiqah: I('tile-fiqah'), scholars: I('tile-scholars'), more: I('tile-more') },
  feats: { chat: I('feat-chat'), reels: I('feat-reels'), profile: I('feat-profile'), consult: I('feat-consult'), ask: I('feat-ask') },
  askBanner: I('ask-banner'),
  footBanner: I('foot-banner'),
};

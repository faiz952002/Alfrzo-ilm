// Photos for the home page. Put the image files in public/img/home/ and write their paths here.
// While a value is null the home page shows a coded illustration in the same place and colours,
// so the page never shows a broken image and never requests a missing file.
//
// Suggested sizes (JPG/WebP for photos, PNG with a transparent background for the scholar):
//   hero      1200 x 760   night mosque scene, the left half kept calm for the text
//   scholar    700 x 900   scholar reading, transparent PNG, facing left
//   cities     480 x 320   one per city
export const HOME_IMAGES = {
  hero: null,          // e.g. '/img/home/hero.jpg'
  scholar: null,       // e.g. '/img/home/scholar.png'
  cities: {
    bengaluru: null,   // e.g. '/img/home/bengaluru.jpg'
    hyderabad: null,
    pune: null,
    mumbai: null,
  },
};

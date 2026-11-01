/* CWS Guide knowledge base. ONLY facts that already appear on the CWS website / README. Add facts here, never invent them.
   Works in the browser (window.CWS_KB) and in Node (require) so the optional AI backend uses the same source of truth. */
(function (root) {
  var PHONE = '+263 77 427 4544', EMAIL = 'chikomborerowaltersumairi26@gmail.com';
  var KB = {
    company: { name: 'CWS Multimedia Connect', tagline: 'Connecting the World As One', location: 'Kadoma, Zimbabwe', owner: 'Chikomborero Walter Sumairi',
      about: 'CWS Multimedia Connect is a creative studio in Kadoma, Zimbabwe. It helps brands, artists, churches and businesses turn ideas into clear, compelling visuals: event flyers, launch graphics, merchandise branding and full identity systems.' },
    contact: { phone: PHONE, email: EMAIL, hours: 'Mon - Sat, 08:00 - 18:00', whatsapp: 'https://wa.me/263774274544?text=Hello%20CWS%20Multimedia%20Connect%2C%20I%20would%20like%20to%20discuss%20my%20design%20project.' },
    packages: [
      { name: 'Flyer / Poster Design', price: '$15 USD / ZWG equivalent', detail: 'For concerts, church programs and promo posts. Single or double-sided, high-resolution print-ready files, optimised for WhatsApp and Instagram, 24 to 48-hour delivery.' },
      { name: 'Full Brand Identity', price: '$35 USD / ZWG equivalent', detail: 'Main logo and alternative versions, colour palette and font system, 3D clothing and product mockups, editable source files.' },
      { name: 'Full Media Package', price: '$70 USD / ZWG equivalent', detail: 'Branding plus social media assets, event flyer set and banner package, mockups and print-style layouts, dedicated revisions and support.' }
    ],
    portfolio: ['Candid With Candy Podcast (apparel mockups, banners, brand identity)', 'Odyssey Jam Session (event poster featuring Jah Prayzah at The Odyssey Kadoma)', 'Christ Gospel Church (Sunday service and seminar flyer)', 'Live Concert Graphics (Odyssey Jam Session featuring Holy 10 & Sulu)'],
    payment: {
      methods: 'EcoCash (manual send to 0774274544, name Chikomborero Walter Sumairi), EcoCash via a Paynow prompt, InnBucks, Zimswitch and PayGo.',
      steps: 'You need to be signed in. Choose a package on the Pricing page, pick a payment method and place the order. Your invoice and order status then appear in your dashboard.',
      creativeconnect: 'For CreativeConnect designs: sign in, press Buy now, pay by EcoCash to 0774274544 and enter the EcoCash reference. After the owner confirms the payment, a private access code (CWS-XXXX-XXXX) appears in your dashboard. Enter it on the CreativeConnect page or dashboard to download your file.'
    },
    creativeconnect: 'CreativeConnect is the design shop: ready-made flyers and designs, editable design packs, and custom-made design. Every design has an item code such as CC-0001.'
  };
  /* Destinations: key -> real page / section. */
  KB.dest = {
    home: { label: 'Home', url: 'index.html', words: ['home', 'homepage', 'start', 'main page'] },
    services: { label: 'Services', url: 'index.html#services', words: ['services', 'what you do', 'what we do', 'offer'] },
    portfolio: { label: 'Portfolio', url: 'work.html', words: ['portfolio', 'work', 'projects', 'past work', 'examples', 'gallery'] },
    pricing: { label: 'Pricing & booking', url: 'pricing.html', words: ['pricing', 'prices', 'price', 'cost', 'packages', 'rates', 'book', 'booking', 'order'] },
    creativeconnect: { label: 'CreativeConnect', url: 'creativeconnect.html', words: ['creativeconnect', 'creative connect', 'shop', 'store', 'templates', 'ready-made', 'catalog'] },
    how: { label: 'How it works', url: 'index.html#how', words: ['how it works', 'how to buy', 'process'] },
    about: { label: 'About', url: 'about.html', words: ['about', 'company', 'studio', 'who are you'] },
    contact: { label: 'Contact', url: 'contact.html', words: ['contact', 'reach', 'call', 'email', 'phone', 'whatsapp', 'hours'] },
    login: { label: 'Sign in', url: 'login.html', words: ['sign in', 'log in', 'login'] },
    signup: { label: 'Create account', url: 'signup.html', words: ['sign up', 'signup', 'register', 'create account', 'create an account'] },
    dashboard: { label: 'Dashboard', url: 'dashboard.html', words: ['dashboard', 'my orders', 'my account', 'invoice', 'invoices', 'access code'] },
    terms: { label: 'Terms & Conditions', url: 'terms.html', words: ['terms', 'conditions'] },
    privacy: { label: 'Privacy Policy', url: 'privacy.html', words: ['privacy'] }
  };
  root.CWS_KB = KB;
  if (typeof module !== 'undefined' && module.exports) module.exports = KB;
})(typeof window !== 'undefined' ? window : globalThis);

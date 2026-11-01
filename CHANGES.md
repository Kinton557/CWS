# CWS Multimedia Connect: modernisation summary

## New files
assets/: cws-logo.svg, cws-logo-dark.svg, cws-logo-white.svg, cws-logo.mask.svg, cws-mark.svg, hero-swoosh.svg, icons.svg, theme-init.js, site.js, guide-kb.js, guide.js, guide.css
favicon.svg, .env.example, DEPLOY.md, CHANGES.md

## Modified
style.css (full rewrite: tokens, dark + light themes, motion, responsive, all original classes kept)
index.html (rebuilt from real content), all other .html (header, footer, theme toggle, Guide, SVG logo; inline CSS removed from login/signup/creativeconnect)
script.js (decorated invoice; old PNG logo injection removed), server.js (optional /api/guide + guideAi flag), README.md
Photos recompressed under the same filenames (7.5 MB -> about 4 MB).

## Not changed
Auth, orders, EcoCash/Paynow logic, invoices API, database, catalog data, all page content and prices.

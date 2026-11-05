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

## Latest
- Accent colour is grey (light grey on the dark theme, dark grey on the light theme). WhatsApp buttons stay green.
- About page: owner photo, name, role and bio plus an "Our other brands" grid, all editable in Dashboard > About page: owner and brands (admin only). New: assets/about.js, /api/about, /api/admin/about, /api/admin/brands.
- Firebase Authentication for login, signup and password reset (assets/firebase-config.js, assets/firebase-auth.js, POST /api/auth/firebase). Old login stays as fallback until the config is filled in.

## Latest (login, analytics, developer, brands)
- Login fix: signed 30-day cookie instead of in-memory sessions; header shows Dashboard / Log out on every page (assets/auth-nav.js); a sleeping server no longer signs you out.
- Dashboard: Website health + Visitor analytics (assets/admin-health.js, admin-analytics.js; /api/staff/health, /api/staff/analytics, /api/track).
- New `developer` role (DEV_EMAILS or Make developer button).
- About: owner photo as hero background (assets/about-bg.jpg); other brands are big picture buttons that open a details pop-up; new "Full details" field per brand.

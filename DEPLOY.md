# Deploy checklist

1. **Server**: Node 18+, `npm install`, `npm start` behind HTTPS (Render, Railway, a VPS, etc.). This is a Node + SQLite app, so static-only hosts (GitHub Pages) will show pages but login, orders and invoices will not work.
2. **Environment**: copy `.env.example` to `.env`; set `NODE_ENV=production`, `BASE_URL`, `SESSION_SECRET`, `ADMIN_PASSWORD`.
3. **Payments (later today)**: create a Paynow merchant integration, put `PAYNOW_INTEGRATION_ID` and `PAYNOW_INTEGRATION_KEY` in `.env`. Set the result URL to `BASE_URL/api/paynow/update`. Until then buyers pay EcoCash manually and the admin presses "Confirm paid".
4. **Domain (later today)**: point the domain's DNS to the host, enable HTTPS, then set `BASE_URL` to `https://your-domain`.
5. **CWS Guide AI (optional)**: add `ANTHROPIC_API_KEY` to `.env` and restart. Visitors then get AI answers grounded in `assets/guide-kb.js`; without it the Guide is a navigation assistant.
6. Never upload `.env`, `data/` or `deliverables/` publicly.

## Custom domain (login only works on onrender.com?)
Sign-in, sign-up and the admin dashboard are handled by this Node server (sessions + SQLite). There is no Firebase. They only work on a domain that points to the Node host (Render).
The `CNAME` file in this repo is for GitHub Pages, which is static-only: if cwsmultimediaconnect.co.zw points there, pages load but `/api/login` and `/api/signup` fail.
Fix: Render dashboard > your service > Settings > Custom Domains > add `cwsmultimediaconnect.co.zw` (and `www.`), then set the DNS records Render shows at your .co.zw registrar, remove any GitHub Pages / old A records, wait for the HTTPS certificate, and set `BASE_URL=https://cwsmultimediaconnect.co.zw` in Render environment variables.
Also keep `NODE_ENV=production` so the secure session cookie works behind Render's proxy.
Uploaded photos live in `uploads/` and the database in `data/`: attach a Render persistent disk (or they are wiped on each redeploy).

## Firebase sign-in (optional, recommended)
Firebase checks the passwords and sends verification and reset emails. The server still keeps the session, orders, invoices and admin rights.
1. console.firebase.google.com > your project (or Add project) > Build > Authentication > Get started > Sign-in method > turn on **Email/Password**.
2. Authentication > Settings > **Authorized domains**: add `cwsmultimediaconnect.co.zw`, `www.cwsmultimediaconnect.co.zw` and `cws-main.onrender.com` (localhost is already there).
3. Project settings > General > Your apps > add a **Web app** > copy `apiKey`, `authDomain`, `projectId`, `appId` into `assets/firebase-config.js`. These values are public and safe to commit.
4. In Render > Environment add `FIREBASE_PROJECT_ID` (same projectId), then redeploy so `npm install` fetches `firebase-admin`.
5. The admin must verify the email (`ADMIN_EMAIL`) once: sign up on the site with that email, open the Firebase verification email, then log in. Until then the admin account is refused on purpose.
Free Spark plan is enough. The domain must still point to Render, because Firebase only handles passwords, not your orders and dashboard.
If `apiKey` is empty the old email + password login keeps working.

## Split hosting (current setup): pages on GitHub Pages, server on Render
- Pages: GitHub Pages serves this repo at https://cwsmultimediaconnect.co.zw (DNS at OneDomain: the GitHub A records and the `www` CNAME stay as they are).
- Server: Render serves the API at https://api.cwsmultimediaconnect.co.zw (CNAME `api` -> `cws-main.onrender.com`, domain added in Render > Settings > Custom Domains). Do NOT add the main or www domain in Render.
- `assets/api-base.js` sends every `/api/...` call from the pages to the API address and keeps the login cookie (the two addresses share the same domain, so the cookie works).
- Render environment variables: `NODE_ENV=production`, `BASE_URL=https://api.cwsmultimediaconnect.co.zw`, `SITE_URL=https://cwsmultimediaconnect.co.zw`, `FIREBASE_PROJECT_ID`, `ADMIN_PASSWORD`, `SESSION_SECRET`. Optional: `ALLOWED_ORIGINS` (comma list, defaults to the main and www addresses).
- Never commit `.env`, `data/` or `deliverables/`: GitHub Pages publishes everything in the repo. A `.gitignore` is included.
- The onrender.com address still serves the pages and works for testing, but Firebase login only works on the authorized domains.

## Staying signed in (important)
Logins are now a signed 30-day cookie, so Render restarts and sleeps no longer sign people out. For this to survive new deploys set **`SESSION_SECRET`** (a long random string) in Render > Environment and never change it. Without it a generated secret is saved in `data/`, which is wiped on every deploy unless you attach a persistent disk. Optional: `COOKIE_SAMESITE` (`lax` or `none`) and `COOKIE_DOMAIN` (e.g. `.cwsmultimediaconnect.co.zw`).

## Developer account (Kinton Technologies)
Developers can open Dashboard > Website health and Visitor analytics (read only; no orders, invoices or customers). Two ways:
1. Set `DEV_EMAILS=dev@example.com` (comma list) in Render. Optional `DEV_PASSWORD` creates the first one. With Firebase they sign up normally and are upgraded after verifying their email.
2. Or, as admin: Dashboard > Registered users > **Make developer**.

## Analytics
Visits are counted on our own server (table `hits`, kept 90 days). Staff and bots are skipped; visitors can opt out from the Privacy page. Public uptime ping for monitors: `GET /api/health`.

## EcoCash PIN prompt (EcoCash Instant Payments)
On the pricing page, "EcoCash – PIN prompt on your phone" charges the buyer's EcoCash wallet through EcoCash's own API. The buyer approves with their PIN and the order turns paid by itself. Paynow, InnBucks and the manual EcoCash option keep working as before.

It switches on when ALL of these are set in Render > Environment, then redeploy:
`EIP_BASE_URL`, `EIP_USERNAME`, `EIP_PASSWORD`, `EIP_MERCHANT_CODE`, `EIP_MERCHANT_PIN`, `EIP_MERCHANT_NUMBER`, `EIP_TERMINAL_ID`, `EIP_MERCHANT_NAME`.
Optional: `EIP_SUPER_MERCHANT_NAME` (default ECOCASH), `EIP_LOCATION` (Harare), `EIP_CHANNEL` (WEB), `EIP_CURRENCY` (USD).
Sandbox address: `https://developers.ecocash.co.zw/sandbox/payment/v1`. Never put these values in GitHub.

Testing in the sandbox: only EcoCash numbers verified under Test Numbers in the EcoCash developer portal can be charged. On the phone, PIN 0000 pays, 1111 not enough money, 2222 wrong PIN. No real money moves.
To take real money you need your own EcoCash merchant account and EcoCash's production credentials; then swap these values and the base URL.

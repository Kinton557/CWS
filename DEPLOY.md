# Deploy checklist

1. **Server**: Node 18+, `npm install`, `npm start` behind HTTPS (Render, Railway, a VPS, etc.). This is a Node + SQLite app, so static-only hosts (GitHub Pages) will show pages but login, orders and invoices will not work.
2. **Environment**: copy `.env.example` to `.env`; set `NODE_ENV=production`, `BASE_URL`, `SESSION_SECRET`, `ADMIN_PASSWORD`.
3. **Payments (later today)**: create a Paynow merchant integration, put `PAYNOW_INTEGRATION_ID` and `PAYNOW_INTEGRATION_KEY` in `.env`. Set the result URL to `BASE_URL/api/paynow/update`. Until then buyers pay EcoCash manually and the admin presses "Confirm paid".
4. **Domain (later today)**: point the domain's DNS to the host, enable HTTPS, then set `BASE_URL` to `https://your-domain`.
5. **CWS Guide AI (optional)**: add `ANTHROPIC_API_KEY` to `.env` and restart. Visitors then get AI answers grounded in `assets/guide-kb.js`; without it the Guide is a navigation assistant.
6. Never upload `.env`, `data/` or `deliverables/` publicly.

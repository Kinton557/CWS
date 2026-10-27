# CWS Multimedia Connect

Owner: Chikomborero Walter Sumairi, Kadoma, Zimbabwe. EcoCash: 0774274544.

## Run it
1. Install Node.js 18 or newer.
2. In this folder run `npm install` then `npm start`.
3. Open http://localhost:3000

## Admin
The admin account is created on first start from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`.
Sign in at /login.html, then use the dashboard to manage designs, orders, invoices and users.

## How buying works
1. Every CreativeConnect design has an item code (CC-0001, CC-0002...), shown to buyers and in the admin dashboard.
2. The buyer signs in, presses Buy now, pays by EcoCash to 0774274544 and enters the EcoCash reference.
3. The admin opens Dashboard > Orders and presses Confirm paid after seeing the money.
4. The buyer's private access code (CWS-XXXX-XXXX) then appears in their dashboard.
5. The buyer enters the code (dashboard or CreativeConnect page) to download the file.

The first six designs use their preview image as a placeholder file. In Dashboard > CreativeConnect catalog > Edit, upload the real file under "File buyers receive".

## Proof of payment
On the buy panel the buyer can paste the EcoCash reference, attach a screenshot, or both. Screenshots are stored privately in `proofs/` and only the buyer and admin can open them (Dashboard > Orders > View proof). A buyer can also add or replace proof later from their dashboard. After ordering, a WhatsApp button lets them message the owner straight away.

## Google and Apple sign-in
Run `npm install` again (adds `jose`). Then set the keys in `.env`; the buttons only show once the keys exist.
- Google: Google Cloud Console > Credentials > OAuth client ID (Web). Add your site address under Authorised JavaScript origins. Put the ID in `GOOGLE_CLIENT_ID`.
- Apple: needs an Apple Developer account and HTTPS. Create a Services ID, add your domain and return URL, then set `APPLE_CLIENT_ID` and `APPLE_REDIRECT_URI`.

## Going live
Copy `.env.example` to `.env`, set `NODE_ENV=production`, your real `BASE_URL`, a long random `SESSION_SECRET` and run behind HTTPS. Never upload `.env`, `data/`, `proofs/` or `deliverables/` to a public folder.

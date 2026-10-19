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

## Going live
Copy `.env.example` to `.env`, set `NODE_ENV=production`, your real `BASE_URL`, a long random `SESSION_SECRET` and run behind HTTPS. Never upload `.env`, `data/` or `deliverables/` to a public folder.

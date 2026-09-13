# Ebook Store Backend

This is the payment + secure-delivery backend for selling your ebook
directly, without Amazon or any other platform.

## What this does

1. Customer clicks "Buy Now" on your landing page.
2. Frontend asks this server to create a Razorpay order (price is
   fixed by the server, so nobody can pay less than intended).
3. Razorpay's checkout popup opens, customer pays.
4. Frontend sends the payment details back here to be verified.
5. Once verified, this server generates a secure, time-limited
   download link and emails it to the customer.
6. The actual ebook file is never publicly accessible — only this
   server can serve it, and only through a valid link.

## Step-by-step setup

### 1. Create a Razorpay account
Go to https://razorpay.com, sign up as an Individual/Business.
You will need basic KYC (PAN card) to accept live payments — until
that's approved, you can fully test everything in **Test Mode**.

From Dashboard → Settings → API Keys, generate a key pair.
You'll get a `Key ID` and `Key Secret`.

### 2. Add your ebook file
Put your actual `.epub` or `.pdf` file inside:
```
server/private-files/
```
This folder is never served directly — only accessible through the
secure download endpoint.

### 3. Configure environment variables
```
cp .env.example .env
```
Then open `.env` and fill in:
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (from step 1)
- `PRODUCT_PRICE_PAISE` (price in paise — ₹599 = 59900)
- `PRODUCT_FILE_NAME` (the exact filename you put in private-files/)
- `SMTP_*` values for sending the download email
  (easiest: create a free account at https://resend.com, or use a
  Gmail account with an "App Password" — not your normal password)

### 4. Install and run locally
```
cd server
npm install
npm start
```
Server runs on `http://localhost:4000` by default.
Test it: open `http://localhost:4000/api/health` — should show `{"ok":true}`.

### 5. Deploy it somewhere real
This needs to run on an actual server (not a static file host).
Easiest free/cheap options:

- **Render.com** — free tier, connect your GitHub repo, set the env
  vars in their dashboard, done.
- **Railway.app** — similar, very simple deploys.

Whichever you pick, add all the same variables from `.env` into
their "Environment Variables" settings — never upload the real
`.env` file to GitHub.

### 6. Connect your frontend
Once deployed, you'll get a URL like `https://your-app.onrender.com`.
Update the landing page's checkout code to call that URL instead of
`localhost:4000`.

### 7. Go live
When ready to accept real payments:
- Complete Razorpay KYC (business/individual verification)
- Switch your API keys from Test Mode to Live Mode in `.env`
- Test one real small transaction yourself first

## Security notes (already handled, but good to understand)

- The price is decided by the server, not the browser — a customer
  can't tamper with the amount before paying.
- Payments are verified using Razorpay's signature check — a fake
  "payment succeeded" message from a browser console can't fool this.
- The ebook file sits outside any public folder — the only way to
  get it is a valid, server-issued, time-limited token.
- Your Razorpay Secret Key and email password live only in `.env` /
  your host's environment variables — never in frontend code.

# UBF Checkout Worker

A tiny Cloudflare Worker that prices the shopping cart **on the server** and
creates a Stripe **Checkout Session**. This guarantees the amount a customer
pays always equals their itemized order, and records the full size/color/qty
breakdown + name + email on every payment in your Stripe Dashboard.

- **Front end:** `Shop.js` POSTs the cart to `/api/checkout`.
- **This Worker:** validates the cart, re-prices at $30/shirt, asks Stripe to
  create a Checkout Session, and returns its URL.
- **Customer:** is redirected to Stripe to pay. On success they land on
  `thank-you-page.html`.

Your site runs on the **www** host (the apex `utahbrazilianfestival.com`
redirects to `www.` before Workers run), so the route is
`www.utahbrazilianfestival.com/api/*`. Your domain is proxied through Cloudflare
(orange cloud), so this works without DNS changes.

---

## One-time setup

### 1. Install Wrangler (Cloudflare's CLI)

```bash
npm install -g wrangler
wrangler login
```

`wrangler login` opens a browser to authorize the CLI against your Cloudflare
account.

### 2. Add your Stripe secret key (never goes in code)

Get your key from the Stripe Dashboard → **Developers → API keys** → *Secret
key* (`sk_live_...` for real charges, `sk_test_...` while testing).

```bash
cd worker
wrangler secret put STRIPE_SECRET_KEY
```

Paste the key when prompted. It is stored encrypted in Cloudflare — it is never
committed to the repo and the browser never sees it.

### 3. Deploy

```bash
wrangler deploy
```

That publishes the Worker and attaches the route
`www.utahbrazilianfestival.com/api/*` (from `wrangler.toml`).

### 4. Verify

Add a shirt on the live site and click **Pay with Card**. You should be
redirected to a Stripe Checkout page showing your exact line items and total.
Use a [Stripe test card](https://stripe.com/docs/testing) (e.g. `4242 4242 4242
4242`, any future expiry/CVC) if you deployed with a `sk_test_` key.

---

## Local testing

Run the Worker locally and point the front end at it:

```bash
cd worker
wrangler secret put STRIPE_SECRET_KEY   # once, if not already set for dev
wrangler dev
```

Wrangler prints a local URL like `http://127.0.0.1:8787`. Temporarily set, in
`Shop.js`:

```js
var CHECKOUT_ENDPOINT = "http://127.0.0.1:8787/api/checkout";
```

Serve the site locally (e.g. `python3 -m http.server 8777` from the project
root) and test at `http://localhost:8777/Shop.html`. **Revert
`CHECKOUT_ENDPOINT` to `"/api/checkout"` before deploying the site.**

---

## How you see who ordered what, and that they paid

Every completed payment in **Stripe → Payments** shows:

- **Amount paid** (equals the order — it can't be tampered with).
- **Line items**: `UBF T-Shirt — Large / White ×2`, etc.
- **Customer email** (collected by Stripe) and **cardholder name**.
- An **order ID** (e.g. `UBF-260810-AB12`) under the payment's metadata and
  `client_reference_id`, mirrored in the thank-you page URL.

Stripe also emails you a notification per successful payment (Dashboard →
**Settings → Notifications**). No separate email service needed.

---

## Optional next step: automatic order emails

If later you want an email of each order (beyond Stripe's own notifications),
add a Stripe **webhook** on `checkout.session.completed` pointing to a second
Worker route, and send yourself the details from there. Not required — the
Dashboard already has everything. Ask and this can be added.

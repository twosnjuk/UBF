# Utah Brazilian Festival — Website

The public website for the **Utah Brazilian Festival** (utahbrazilianfestival.com),
including a self-serve **festival T-shirt shop** with card/Apple Pay/Google Pay
checkout powered by Stripe.

- **Live site:** https://www.utahbrazilianfestival.com
- **Shop:** https://www.utahbrazilianfestival.com/Shop.html

---

## Overview

The marketing pages (Home, About, Blog) are a static site built with
[Nicepage](https://nicepage.com/). On top of that sits a custom **T-shirt shop**
(`Shop.html` + `Shop.css` + `Shop.js`) with a client-side cart and a Stripe
checkout that is priced **server-side** by a small Cloudflare Worker, so the
amount a customer pays always matches their itemized order.

Everything the browser loads is plain, dependency-light HTML/CSS/JS — there is no
build step for the site itself.

---

## Architecture

```
                 ┌─────────────────────────────────────────────┐
  Customer  ──▶  │  Cloudflare (DNS + proxy + cache)            │
                 │     │                                        │
                 │     ├── /api/checkout  ──▶  Cloudflare Worker │──▶ Stripe API
                 │     │                       (prices cart,      │   (Checkout
                 │     │                        creates Session)  │    Session)
                 │     │                                        │
                 │     └── everything else ─▶ CloudFront ─▶ S3   │  (static files)
                 └─────────────────────────────────────────────┘
```

- **Static files** (`*.html`, `Shop.css`, `Shop.js`, images…) live in an **S3**
  bucket, served through **CloudFront**, fronted by **Cloudflare**.
- The path **`/api/checkout`** is intercepted by a **Cloudflare Worker**
  (`worker/`) that talks to Stripe. It never touches S3/CloudFront.
- The apex `utahbrazilianfestival.com` redirects to `www.` — the Worker route is
  therefore on the **`www`** host.

### Checkout flow

1. Customer adds shirts (size / color / quantity) to a cart stored in
   `localStorage`.
2. On **Pay with Card**, `Shop.js` POSTs the cart to `/api/checkout`.
3. The Worker re-prices the cart at **$30/shirt** (ignoring any client-supplied
   price), builds a Stripe **Checkout Session** with one line item per shirt, and
   returns the Stripe URL. It also attaches an **order ID**
   (e.g. `UBF-260811-AB12`) as `client_reference_id`.
4. The browser redirects to Stripe. Because the amount is derived from the line
   items on the server, **paid always equals ordered**.
5. On success, Stripe redirects to `thank-you-page.html`, which **clears the
   cart** and shows the order number.

You reconcile "who ordered what" and "did they pay" directly in the **Stripe
Dashboard** — each payment shows the line items, customer email, and the order
ID. Stripe also emails a receipt/notification (when enabled in Stripe settings).

---

## Repository structure

```
.
├── index.html / Home.html / About.html   # Nicepage marketing pages
├── Shop.html                             # T-shirt shop (custom)
├── Shop.css / Shop.js                    # Shop styles + cart/checkout logic
├── thank-you-page.html                   # Post-payment page (clears cart)
├── *.css                                 # Nicepage page/template styles
├── nicepage.css / nicepage.js / jquery.js
├── images/                               # Site images (logo, t-shirt, etc.)
├── blog/                                 # Blog pages
├── intlTelInput/                         # Phone-input assets (Nicepage)
├── worker/                               # Cloudflare Worker for Stripe checkout
│   ├── checkout.js                       #   prices cart, creates Checkout Session
│   ├── wrangler.toml                     #   route + config (no secrets)
│   └── README.md                         #   Worker deploy guide
├── deploy.sh                             # Deploy: S3 sync + CloudFront + Cloudflare purge
└── sync.sh                               # ⚠️ legacy deploy (superseded by deploy.sh)
```

---

## Local development

No build step. Serve the folder and open the shop:

```bash
python3 -m http.server 8777
# then visit http://localhost:8777/Shop.html
```

To exercise the **checkout** locally, run the Worker with Wrangler and point the
front end at it (see [`worker/README.md`](worker/README.md)):

```bash
cd worker
wrangler dev
# temporarily set CHECKOUT_ENDPOINT in Shop.js to the wrangler URL,
# e.g. "http://127.0.0.1:8787/api/checkout" — revert before deploying.
```

> Note: on `localhost` the reCAPTCHA badge shows a "site key not supported"
> message. That is expected and does not appear on the live domain.

---

## Deployment

### Static site → S3 / CloudFront / Cloudflare

```bash
./deploy.sh
```

This uploads changed files to S3 (excluding hidden files, `worker/`, and the
script itself), invalidates the CloudFront cache, and purges the Cloudflare
cache. The Cloudflare purge requires `CF_API_TOKEN` to be exported (a token with
**Zone → Cache Purge** and **Zone → Read**); without it, that step is skipped and
the rest still runs.

> `sync.sh` is an older equivalent that lacks the hidden-file excludes and the
> Cloudflare purge — use `deploy.sh`.

### Checkout Worker → Cloudflare

Deployed separately (only when `worker/checkout.js` changes):

```bash
cd worker
wrangler deploy
```

Full instructions, including setting the Stripe secret, are in
[`worker/README.md`](worker/README.md).

---

## Configuration & secrets

Secrets are **never** committed. They live outside the repo:

| Secret / value        | Where it lives                                        |
|-----------------------|-------------------------------------------------------|
| `STRIPE_SECRET_KEY`   | Cloudflare Worker secret (`wrangler secret put …`)    |
| `CF_API_TOKEN`        | Your shell env (e.g. `~/.zshrc`), used by `deploy.sh` |
| AWS credentials       | `aws configure` (`~/.aws/…`)                          |

Non-secret infrastructure IDs (S3 bucket, CloudFront distribution) are set at the
top of `deploy.sh`; the Worker route and site origin are in `worker/wrangler.toml`.

### Stripe notes

- **Payment methods** (cards, Apple Pay, Google Pay, Link, …) are controlled in
  the Stripe Dashboard under **Settings → Payment methods**. The Worker does not
  restrict them, so all enabled methods appear automatically on supported devices.
  Apple Pay/Google Pay need no domain verification because checkout is
  Stripe-hosted.
- To email customers a receipt, enable **Settings → Customer emails → Successful
  payments** (live mode).
- Test with a `sk_test_` key and card `4242 4242 4242 4242`; switch the Worker
  secret to `sk_live_` to take real payments.

---

## Caching notes

There are two caches in front of the origin: **CloudFront** and **Cloudflare**.
`deploy.sh` clears both. HTML is served with a long browser cache by default, so
after a deploy your own browser may need a hard refresh (Cmd/Ctrl+Shift+R). A
Cloudflare Cache Rule that lowers the **browser** TTL for `.html` keeps returning
visitors from seeing stale pages after updates.

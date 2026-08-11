/**
 * UBF T-Shirt checkout Worker.
 *
 * Receives the cart from the shop page, RE-PRICES it on the server (so the
 * amount charged can never be tampered with from the browser), and creates a
 * Stripe Checkout Session. The browser is then redirected to Stripe to pay.
 *
 * Because the line items and amount are built here, the amount the customer
 * pays ALWAYS equals the itemized order — and every paid order shows the full
 * size/color/qty breakdown + name + email in your Stripe Dashboard.
 *
 * Secret required (set with: wrangler secret put STRIPE_SECRET_KEY):
 *   STRIPE_SECRET_KEY  -> your Stripe secret key (sk_live_... or sk_test_...)
 *
 * Optional vars (wrangler.toml [vars] or dashboard):
 *   SITE_ORIGIN   -> e.g. "https://utahbrazilianfestival.com" (used for
 *                    success/cancel URLs and CORS). Defaults to the request's
 *                    own origin when not set.
 */

var PRICE_CENTS = 3000; // $30.00 per shirt — the single source of truth.
var MAX_QTY_PER_LINE = 20;
var MAX_LINES = 50;

var ALLOWED_SIZES = ["X-Small", "Small", "Medium", "Large", "X-Large", "XX-Large"];
var ALLOWED_COLORS = ["White", "Yellow", "Blue", "Green"];

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders(origin))
  });
}

function makeOrderId() {
  var d = new Date();
  function p(n) { return (n < 10 ? "0" : "") + n; }
  var stamp = String(d.getUTCFullYear()).slice(2) + p(d.getUTCMonth() + 1) + p(d.getUTCDate());
  var rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return "UBF-" + stamp + "-" + rand;
}

/**
 * Validate + normalize the incoming cart. Returns { items, count } or throws.
 * Only size/color labels come from the client; the PRICE never does.
 */
function normalizeCart(rawCart) {
  if (!Array.isArray(rawCart) || rawCart.length === 0) {
    throw new Error("Your cart is empty.");
  }
  if (rawCart.length > MAX_LINES) {
    throw new Error("Too many line items.");
  }

  var items = [];
  var count = 0;

  for (var i = 0; i < rawCart.length; i++) {
    var entry = rawCart[i] || {};
    var size = String(entry.size || "");
    var color = String(entry.color || "");
    var qty = parseInt(entry.qty, 10);

    if (ALLOWED_SIZES.indexOf(size) === -1) {
      throw new Error("Invalid size: " + size);
    }
    if (ALLOWED_COLORS.indexOf(color) === -1) {
      throw new Error("Invalid color: " + color);
    }
    if (!qty || qty < 1 || qty > MAX_QTY_PER_LINE) {
      throw new Error("Invalid quantity for " + size + " / " + color);
    }

    items.push({ size: size, color: color, qty: qty });
    count += qty;
  }

  return { items: items, count: count };
}

/**
 * Build the application/x-www-form-urlencoded body Stripe expects for a
 * Checkout Session, with one line item per cart entry.
 */
function buildStripeBody(cart, orderId, email, name, successUrl, cancelUrl) {
  var params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", successUrl);
  params.set("cancel_url", cancelUrl);
  params.set("client_reference_id", orderId);
  params.set("billing_address_collection", "auto");
  // Always capture the buyer's email on the Stripe page.
  if (email) {
    params.set("customer_email", email);
  }

  // Helpful metadata that shows on the payment in the Dashboard.
  params.set("metadata[order_id]", orderId);
  params.set("metadata[item_count]", String(cart.count));
  if (name) {
    params.set("metadata[customer_name]", name.slice(0, 200));
  }

  cart.items.forEach(function (item, idx) {
    var base = "line_items[" + idx + "]";
    params.set(base + "[quantity]", String(item.qty));
    params.set(base + "[price_data][currency]", "usd");
    params.set(base + "[price_data][unit_amount]", String(PRICE_CENTS));
    params.set(base + "[price_data][product_data][name]", "UBF T-Shirt — " + item.size + " / " + item.color);
  });

  return params.toString();
}

async function createCheckoutSession(secretKey, body) {
  var resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + secretKey,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body
  });

  var data = await resp.json();
  if (!resp.ok) {
    var msg = (data && data.error && data.error.message) || "Stripe error";
    throw new Error(msg);
  }
  return data;
}

export default {
  async fetch(request, env) {
    var origin = (env && env.SITE_ORIGIN) || new URL(request.url).origin;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, origin);
    }

    if (!env || !env.STRIPE_SECRET_KEY) {
      return json({ error: "Server not configured (missing STRIPE_SECRET_KEY)." }, 500, origin);
    }

    var payload;
    try {
      payload = await request.json();
    } catch (e) {
      return json({ error: "Invalid request body." }, 400, origin);
    }

    var cart;
    try {
      cart = normalizeCart(payload && payload.cart);
    } catch (e) {
      return json({ error: e.message }, 400, origin);
    }

    var email = payload && payload.email ? String(payload.email).slice(0, 200) : "";
    var name = payload && payload.name ? String(payload.name).slice(0, 200) : "";
    var orderId = makeOrderId();

    var successUrl = origin + "/thank-you-page.html?order=" + encodeURIComponent(orderId) +
      "&session_id={CHECKOUT_SESSION_ID}";
    var cancelUrl = origin + "/Shop.html";

    try {
      var body = buildStripeBody(cart, orderId, email, name, successUrl, cancelUrl);
      var session = await createCheckoutSession(env.STRIPE_SECRET_KEY, body);
      return json({ url: session.url, orderId: orderId }, 200, origin);
    } catch (e) {
      return json({ error: e.message || "Could not start checkout." }, 502, origin);
    }
  }
};

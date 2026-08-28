(function () {
  "use strict";

  var PRICE = 30.00;
  var CART_KEY = "ubfShopCart";

  // The checkout Worker prices the cart server-side and creates a Stripe
  // Checkout Session. Same-origin path in production; the Worker is routed at
  // /api/* by Cloudflare. For local testing with `wrangler dev`, point this at
  // the wrangler URL (e.g. "http://127.0.0.1:8787/api/checkout").
  var CHECKOUT_ENDPOINT = "/api/checkout";

  function getCart() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }

  function formatMoney(amount) {
    return amount.toFixed(2);
  }

  function cartTotal(cart) {
    return cart.reduce(function (sum, item) {
      return sum + item.qty * PRICE;
    }, 0);
  }

  function cartItemCount(cart) {
    return cart.reduce(function (sum, item) {
      return sum + item.qty;
    }, 0);
  }

  function addToCart(size, qty) {
    var cart = getCart();
    var existing = null;

    for (var i = 0; i < cart.length; i++) {
      if (cart[i].size === size) {
        existing = cart[i];
        break;
      }
    }

    if (existing) {
      existing.qty += qty;
    } else {
      cart.push({ size: size, qty: qty });
    }

    saveCart(cart);
    renderCart();
  }

  function removeFromCart(index) {
    var cart = getCart();
    cart.splice(index, 1);
    saveCart(cart);
    renderCart();
  }

  function buildOrderSummary(cart, total) {
    var lines = cart.map(function (item) {
      return "- " + item.qty + " x " + item.size + " ($" + formatMoney(item.qty * PRICE) + ")";
    });
    lines.push("");
    lines.push("Total: $" + formatMoney(total));
    return "Utah Brazilian Festival T-Shirt Order\n" + lines.join("\n");
  }

  function setStripeButtonBusy(btn, busy) {
    if (!btn) return;
    if (busy) {
      btn.setAttribute("aria-disabled", "true");
      btn.classList.add("shop-btn-disabled");
      if (!btn.getAttribute("data-label")) {
        btn.setAttribute("data-label", btn.textContent);
      }
      btn.textContent = "Starting checkout…";
    } else {
      btn.removeAttribute("aria-disabled");
      btn.classList.remove("shop-btn-disabled");
      var label = btn.getAttribute("data-label");
      if (label) btn.textContent = label;
    }
  }

  // Send the cart to the checkout Worker, which prices it server-side and
  // returns a Stripe Checkout Session URL to redirect the customer to.
  function startCheckout(btn) {
    var cart = getCart();
    if (cart.length === 0) {
      window.alert("Your cart is empty. Please add a t-shirt before paying.");
      return;
    }

    var nameEl = document.getElementById("shop-name");
    var emailEl = document.getElementById("shop-email");
    var name = nameEl ? nameEl.value.trim() : "";
    var email = emailEl ? emailEl.value.trim() : "";

    setStripeButtonBusy(btn, true);

    fetch(CHECKOUT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cart: cart, name: name, email: email })
    })
      .then(function (resp) {
        return resp.json().then(function (data) {
          return { ok: resp.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok && result.data && result.data.url) {
          window.location.href = result.data.url;
        } else {
          var msg = (result.data && result.data.error) || "Sorry, we couldn't start checkout. Please try again.";
          window.alert(msg);
          setStripeButtonBusy(btn, false);
        }
      })
      .catch(function () {
        window.alert("Sorry, we couldn't reach checkout. Please check your connection and try again.");
        setStripeButtonBusy(btn, false);
      });
  }

  function handleStripeClick() {
    return function (e) {
      e.preventDefault();
      if (e.currentTarget.getAttribute("aria-disabled") === "true" && getCart().length === 0) {
        window.alert("Your cart is empty. Please add a t-shirt before paying.");
        return;
      }
      startCheckout(e.currentTarget);
    };
  }

  function renderCart() {
    var itemsEl = document.getElementById("cart-items");
    if (!itemsEl) {
      return;
    }

    var cart = getCart();
    var emptyEl = document.getElementById("cart-empty-message");
    var summaryEl = document.getElementById("cart-summary");
    var totalEl = document.getElementById("cart-total");
    var countEl = document.getElementById("cart-item-count");
    var checkoutTotalEl = document.getElementById("checkout-total");
    var messageEl = document.getElementById("shop-message");
    var stripeBtn = document.getElementById("pay-stripe");

    itemsEl.innerHTML = "";

    if (cart.length === 0) {
      if (emptyEl) emptyEl.hidden = false;
      itemsEl.hidden = true;
      if (summaryEl) summaryEl.hidden = true;

      if (stripeBtn) {
        stripeBtn.classList.add("shop-btn-disabled");
        stripeBtn.setAttribute("aria-disabled", "true");
      }
    } else {
      if (emptyEl) emptyEl.hidden = true;
      itemsEl.hidden = false;
      if (summaryEl) summaryEl.hidden = false;

      if (stripeBtn) {
        stripeBtn.classList.remove("shop-btn-disabled");
        stripeBtn.removeAttribute("aria-disabled");
      }

      cart.forEach(function (item, index) {
        var row = document.createElement("div");
        row.className = "shop-cart-item";

        var desc = document.createElement("span");
        desc.className = "shop-cart-item-desc";
        desc.textContent = item.qty + " × " + item.size;

        var price = document.createElement("span");
        price.className = "shop-cart-item-price";
        price.textContent = "$" + formatMoney(item.qty * PRICE);

        var remove = document.createElement("a");
        remove.href = "#";
        remove.className = "shop-cart-item-remove";
        remove.setAttribute("data-index", String(index));
        remove.setAttribute("aria-label", "Remove item");
        remove.textContent = "Remove";

        row.appendChild(desc);
        row.appendChild(price);
        row.appendChild(remove);
        itemsEl.appendChild(row);
      });
    }

    var total = cartTotal(cart);
    var count = cartItemCount(cart);

    if (totalEl) totalEl.textContent = formatMoney(total);
    if (countEl) countEl.textContent = String(count);
    if (checkoutTotalEl) checkoutTotalEl.textContent = formatMoney(total);
    if (messageEl) messageEl.value = cart.length ? buildOrderSummary(cart, total) : "";
  }

  document.addEventListener("DOMContentLoaded", function () {
    renderCart();

    var addBtn = document.getElementById("add-to-cart-btn");
    if (addBtn) {
      addBtn.addEventListener("click", function (e) {
        e.preventDefault();

        var size = document.getElementById("shirt-size").value;
        var qty = parseInt(document.getElementById("shirt-qty").value, 10);

        if (!qty || qty < 1) {
          qty = 1;
        }

        addToCart(size, qty);
      });
    }

    var itemsEl = document.getElementById("cart-items");
    if (itemsEl) {
      itemsEl.addEventListener("click", function (e) {
        var target = e.target;
        if (target && target.classList.contains("shop-cart-item-remove")) {
          e.preventDefault();
          removeFromCart(parseInt(target.getAttribute("data-index"), 10));
        }
      });
    }

    var emailInput = document.getElementById("shop-email");
    if (emailInput) {
      emailInput.addEventListener("input", renderCart);
    }

    var stripeBtn = document.getElementById("pay-stripe");
    if (stripeBtn) {
      stripeBtn.addEventListener("click", handleStripeClick());
    }
  });
})();

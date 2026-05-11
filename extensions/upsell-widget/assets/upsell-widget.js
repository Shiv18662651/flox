/**
 * Nexify Upsell Widget - Theme App Extension
 * Requirements: 6.2, 6.3, 6.4, 6.6, 6.7
 *
 * Fetches active upsell offers from the API and displays them based on placement type.
 * Tracks impressions on display and conversions on accept.
 */
(function () {
  "use strict";

  var widget = document.getElementById("nexify-upsell-widget");
  if (!widget) return;

  var shopId = widget.getAttribute("data-shop-id");
  var placement = widget.getAttribute("data-placement");
  var appUrl = widget.getAttribute("data-app-url");
  var productId = widget.getAttribute("data-product-id");

  if (!shopId || !placement || !appUrl) return;

  var apiBase = appUrl.replace(/\/$/, "") + "/api/upsells";

  /**
   * Fetch active upsell offers from the API
   */
  function fetchOffers() {
    var url = apiBase + "?shopId=" + encodeURIComponent(shopId) + "&type=" + encodeURIComponent(placement);
    if (productId && placement === "product_page") {
      url += "&productId=" + encodeURIComponent(productId);
    }

    fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } })
      .then(function (response) {
        if (!response.ok) throw new Error("Failed to fetch upsell offers");
        return response.json();
      })
      .then(function (data) {
        if (data.offers && data.offers.length > 0) {
          displayOffer(data.offers[0]);
        }
      })
      .catch(function (err) {
        console.warn("[Nexify Upsell] Error fetching offers:", err.message);
      });
  }

  /**
   * Track an impression or conversion
   */
  function trackEvent(upsellId, action, revenue) {
    var body = { upsellId: upsellId, action: action };
    if (revenue !== undefined && revenue > 0) {
      body.revenue = revenue;
    }

    fetch(apiBase, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(function (err) {
      console.warn("[Nexify Upsell] Error tracking " + action + ":", err.message);
    });
  }

  /**
   * Display the upsell offer based on placement type
   */
  function displayOffer(offer) {
    widget.style.display = "block";

    if (placement === "cart") {
      displayStickyBar(offer);
    } else {
      displayCard(offer);
    }

    // Track impression
    trackEvent(offer.id, "impression");
  }

  /**
   * Display as a centered card (post_purchase, thank_you, product_page)
   */
  function displayCard(offer) {
    var card = document.getElementById("nexify-upsell-card");
    var titleEl = document.getElementById("nexify-upsell-title");
    var productEl = document.getElementById("nexify-upsell-product");
    var discountEl = document.getElementById("nexify-upsell-discount");
    var acceptBtn = document.getElementById("nexify-upsell-accept");
    var dismissBtn = document.getElementById("nexify-upsell-dismiss");

    if (!card) return;

    titleEl.textContent = offer.title;
    productEl.textContent = offer.productId ? "Product: " + offer.productId : "";

    if (offer.discountPercent > 0) {
      discountEl.textContent = offer.discountPercent + "% OFF";
      discountEl.style.display = "block";
    }

    card.style.display = "block";

    acceptBtn.addEventListener("click", function () {
      trackEvent(offer.id, "conversion", 0);
      card.style.display = "none";
      // In production, this would trigger the server-side add-to-order flow
      alert("Offer accepted! The product will be added to your order.");
    });

    dismissBtn.addEventListener("click", function () {
      card.style.display = "none";
      widget.style.display = "none";
    });
  }

  /**
   * Display as a sticky bar at the bottom (cart placement)
   */
  function displayStickyBar(offer) {
    var bar = document.getElementById("nexify-upsell-bar");
    var titleEl = document.getElementById("nexify-upsell-bar-title");
    var discountEl = document.getElementById("nexify-upsell-bar-discount");
    var acceptBtn = document.getElementById("nexify-upsell-bar-accept");
    var closeBtn = document.getElementById("nexify-upsell-bar-close");

    if (!bar) return;

    titleEl.textContent = offer.title;

    if (offer.discountPercent > 0) {
      discountEl.textContent = offer.discountPercent + "% OFF";
    } else {
      discountEl.textContent = "";
    }

    bar.style.display = "block";

    acceptBtn.addEventListener("click", function () {
      trackEvent(offer.id, "conversion", 0);
      bar.style.display = "none";
      // In production, this would add the product to the cart via Shopify AJAX API
      alert("Product added to cart!");
    });

    closeBtn.addEventListener("click", function () {
      bar.style.display = "none";
      widget.style.display = "none";
    });
  }

  // Initialize: fetch offers when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fetchOffers);
  } else {
    fetchOffers();
  }
})();

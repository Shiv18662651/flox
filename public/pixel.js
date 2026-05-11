/**
 * Nexify Analytics Pixel
 * First-party JavaScript pixel for storefront embedding via Shopify Script Tag.
 * Uses localStorage for session/visitor identification — no third-party cookies.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4
 */
(function () {
  "use strict";

  // Configuration — APP_URL is injected by the Script Tag or set as a data attribute
  var scriptTag = document.currentScript || document.querySelector('script[data-nexify-pixel]');
  var APP_URL = (scriptTag && scriptTag.getAttribute("data-app-url")) || "";
  var SHOP_ID = (scriptTag && scriptTag.getAttribute("data-shop-id")) || "";

  if (!APP_URL || !SHOP_ID) {
    console.warn("[Nexify Pixel] Missing data-app-url or data-shop-id attributes.");
    return;
  }

  var PIXEL_ENDPOINT = APP_URL + "/api/pixel";

  // --- Session & Visitor ID Management (localStorage, first-party only) ---

  function generateId() {
    // Generate a random ID using available APIs
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getOrCreateId(key) {
    try {
      var existing = localStorage.getItem(key);
      if (existing) return existing;
      var newId = generateId();
      localStorage.setItem(key, newId);
      return newId;
    } catch (e) {
      // localStorage unavailable (private browsing, etc.)
      return generateId();
    }
  }

  var visitorId = getOrCreateId("nexify_visitor_id");
  var sessionId = getOrCreateId("nexify_session_id");

  // Rotate session ID after 30 minutes of inactivity
  var SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  try {
    var lastActivity = localStorage.getItem("nexify_last_activity");
    if (lastActivity && Date.now() - parseInt(lastActivity, 10) > SESSION_TIMEOUT_MS) {
      sessionId = generateId();
      localStorage.setItem("nexify_session_id", sessionId);
    }
    localStorage.setItem("nexify_last_activity", String(Date.now()));
  } catch (e) {
    // Ignore localStorage errors
  }

  // --- UTM Parameter Extraction ---

  function getUtmParams() {
    var params = {};
    try {
      var search = window.location.search;
      var urlParams = new URLSearchParams(search);
      var utmKeys = ["utm_source", "utm_medium", "utm_campaign"];
      for (var i = 0; i < utmKeys.length; i++) {
        var val = urlParams.get(utmKeys[i]);
        if (val) params[utmKeys[i]] = val;
      }
    } catch (e) {
      // URLSearchParams not available in very old browsers
    }
    return params;
  }

  // --- Event Sending ---

  function sendEvent(eventData) {
    var payload = JSON.stringify(eventData);

    // Prefer sendBeacon for reliability on page unload
    if (navigator.sendBeacon) {
      var blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(PIXEL_ENDPOINT, blob);
    } else {
      // Fallback to fetch
      try {
        fetch(PIXEL_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(function () {});
      } catch (e) {
        // Silently fail — never break the storefront
      }
    }
  }

  function buildBaseEvent(eventType) {
    var utmParams = getUtmParams();
    return {
      shopId: SHOP_ID,
      sessionId: sessionId,
      visitorId: visitorId,
      eventType: eventType,
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
      source: utmParams.utm_source || null,
      medium: utmParams.utm_medium || null,
      campaign: utmParams.utm_campaign || null,
    };
  }

  // --- Page View Event ---

  function trackPageView() {
    var event = buildBaseEvent("page_view");
    sendEvent(event);
  }

  // --- Add to Cart Event ---

  function trackAddToCart(productId, variantId) {
    var event = buildBaseEvent("add_to_cart");
    event.productId = productId || null;
    event.variantId = variantId || null;
    sendEvent(event);
  }

  // Listen for Shopify's native add-to-cart form submissions
  function setupAddToCartListeners() {
    // Method 1: Listen for form submissions on product forms
    document.addEventListener("submit", function (e) {
      var form = e.target;
      if (
        form &&
        form.tagName === "FORM" &&
        (form.action.indexOf("/cart/add") !== -1 || form.getAttribute("action") === "/cart/add")
      ) {
        var productIdInput = form.querySelector('[name="id"]') || form.querySelector('[name="variant_id"]');
        var productId = productIdInput ? productIdInput.value : null;
        trackAddToCart(productId, productId);
      }
    });

    // Method 2: Intercept fetch/XHR calls to /cart/add.js (AJAX add-to-cart)
    if (typeof window.fetch === "function") {
      var originalFetch = window.fetch;
      window.fetch = function () {
        var url = arguments[0];
        var urlStr = typeof url === "string" ? url : (url && url.url) || "";
        if (urlStr.indexOf("/cart/add") !== -1) {
          try {
            var opts = arguments[1] || {};
            if (opts.body) {
              var body = typeof opts.body === "string" ? JSON.parse(opts.body) : null;
              if (body && body.id) {
                trackAddToCart(String(body.id), String(body.id));
              }
            }
          } catch (e) {
            // Silently fail
          }
        }
        return originalFetch.apply(this, arguments);
      };
    }
  }

  // --- Initialize ---

  trackPageView();
  setupAddToCartListeners();
})();

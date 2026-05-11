/**
 * Nexify FOMO Widget - Social Proof Popups
 *
 * Connects to Socket.io for real-time purchase notifications.
 * Falls back to REST polling at 30-second intervals on connection failure.
 * On product pages, filters events to only show the currently viewed product.
 */
(function () {
  'use strict';

  var container = document.getElementById('nexify-fomo');
  if (!container) return;

  var appUrl = container.dataset.appUrl;
  var shopId = container.dataset.shopId;
  var productId = container.dataset.productId || null;

  if (!appUrl || !shopId) return;

  // Remove trailing slash from appUrl
  appUrl = appUrl.replace(/\/+$/, '');

  // State
  var settings = {
    popupPosition: 'bottom-left',
    displayDuration: 5,
    showHistoricalOrders: true,
    historicalInterval: 10
  };
  var popup = document.getElementById('nexify-fomo-popup');
  var closeBtn = document.getElementById('nexify-fomo-close');
  var buyerEl = document.getElementById('nexify-fomo-buyer');
  var productEl = document.getElementById('nexify-fomo-product');
  var timeEl = document.getElementById('nexify-fomo-time');
  var dismissTimer = null;
  var isShowing = false;
  var eventQueue = [];
  var socket = null;
  var pollInterval = null;
  var historicalOrders = [];
  var historicalIndex = 0;
  var historicalTimer = null;
  var usePolling = false;

  // Initialize position
  function applyPosition() {
    container.className = 'nexify-fomo nexify-fomo--' + settings.popupPosition;
  }

  // Relative time formatting
  function relativeTime(timestamp) {
    var now = Date.now();
    var then = new Date(timestamp).getTime();
    var diff = Math.max(0, Math.floor((now - then) / 1000));

    if (diff < 60) return 'just now';
    if (diff < 3600) {
      var mins = Math.floor(diff / 60);
      return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
    }
    if (diff < 86400) {
      var hours = Math.floor(diff / 3600);
      return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    }
    var days = Math.floor(diff / 86400);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }

  // Show popup with event data
  function showPopup(event) {
    if (isShowing) {
      eventQueue.push(event);
      return;
    }

    isShowing = true;
    buyerEl.textContent = (event.buyerName || 'Someone') + ' just purchased';
    productEl.textContent = event.productTitle || 'a product';
    timeEl.textContent = relativeTime(event.timestamp);

    popup.style.display = 'flex';
    // Force reflow for transition
    popup.offsetHeight; // eslint-disable-line no-unused-expressions
    popup.classList.add('nexify-fomo__popup--visible');
    popup.classList.remove('nexify-fomo__popup--hiding');

    // Auto-dismiss
    clearTimeout(dismissTimer);
    dismissTimer = setTimeout(function () {
      hidePopup();
    }, settings.displayDuration * 1000);
  }

  // Hide popup with animation
  function hidePopup() {
    popup.classList.add('nexify-fomo__popup--hiding');
    popup.classList.remove('nexify-fomo__popup--visible');

    setTimeout(function () {
      popup.style.display = 'none';
      popup.classList.remove('nexify-fomo__popup--hiding');
      isShowing = false;

      // Show next queued event
      if (eventQueue.length > 0) {
        var next = eventQueue.shift();
        setTimeout(function () {
          showPopup(next);
        }, 500);
      }
    }, 300);
  }

  // Close button handler
  closeBtn.addEventListener('click', function () {
    clearTimeout(dismissTimer);
    hidePopup();
  });

  // Filter event based on product page context
  function shouldShowEvent(event) {
    if (!productId) return true;
    if (!event.productId) return true;
    return String(event.productId) === String(productId);
  }

  // Handle incoming FOMO event
  function handleFomoEvent(event) {
    if (!shouldShowEvent(event)) return;
    showPopup(event);
  }

  // Connect to Socket.io
  function connectSocket() {
    if (typeof io === 'undefined') {
      startPolling();
      return;
    }

    try {
      socket = io(appUrl, {
        path: '/socket.io/',
        query: { shopId: shopId },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 16000
      });

      socket.on('connect', function () {
        usePolling = false;
        stopPolling();
      });

      socket.on('fomo:purchase', function (event) {
        handleFomoEvent(event);
      });

      socket.on('connect_error', function () {
        if (!usePolling) {
          usePolling = true;
          startPolling();
        }
      });

      socket.on('disconnect', function (reason) {
        if (reason === 'io server disconnect' || reason === 'io client disconnect') {
          // Intentional disconnect, start polling
          usePolling = true;
          startPolling();
        }
        // Otherwise Socket.io will auto-reconnect
      });

      // If reconnection fails completely, fall back to polling
      socket.io.on('reconnect_failed', function () {
        usePolling = true;
        startPolling();
      });
    } catch (e) {
      startPolling();
    }
  }

  // REST API polling fallback
  function startPolling() {
    if (pollInterval) return;

    fetchFomoData();
    pollInterval = setInterval(fetchFomoData, 30000);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    stopHistoricalCycle();
  }

  function fetchFomoData() {
    var url = appUrl + '/api/fomo?shopId=' + encodeURIComponent(shopId);
    if (productId) {
      url += '&productId=' + encodeURIComponent(productId);
    }

    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        // Update settings from response
        if (data.settings) {
          if (data.settings.popupPosition) settings.popupPosition = data.settings.popupPosition;
          if (data.settings.displayDuration) settings.displayDuration = data.settings.displayDuration;
          if (typeof data.settings.showHistoricalOrders !== 'undefined') {
            settings.showHistoricalOrders = data.settings.showHistoricalOrders;
          }
          if (data.settings.historicalInterval) settings.historicalInterval = data.settings.historicalInterval;
          applyPosition();
        }

        // Handle historical orders (API returns "events" array)
        var orders = data.events || data.orders || [];
        if (orders.length > 0 && settings.showHistoricalOrders) {
          historicalOrders = orders;
          historicalIndex = 0;
          startHistoricalCycle();
        }
      })
      .catch(function () {
        // Silently fail — will retry on next poll interval
      });
  }

  // Cycle through historical orders
  function startHistoricalCycle() {
    stopHistoricalCycle();
    if (historicalOrders.length === 0) return;

    showNextHistorical();
    historicalTimer = setInterval(function () {
      showNextHistorical();
    }, settings.historicalInterval * 1000);
  }

  function stopHistoricalCycle() {
    if (historicalTimer) {
      clearInterval(historicalTimer);
      historicalTimer = null;
    }
  }

  function showNextHistorical() {
    if (historicalOrders.length === 0) return;

    var order = historicalOrders[historicalIndex];
    historicalIndex = (historicalIndex + 1) % historicalOrders.length;

    if (shouldShowEvent(order)) {
      showPopup(order);
    }
  }

  // Initialize
  applyPosition();
  connectSocket();
})();

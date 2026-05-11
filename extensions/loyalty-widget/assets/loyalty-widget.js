// Loyalty Widget - Theme App Extension
// Fetches customer balance from public API and displays points + reward value
// Also displays referral sharing link when referral program is active
// Requirements: 8.7, 8.9, 11.8

(function () {
  'use strict';

  const WIDGET_ID = 'nexify-loyalty-widget';
  const POLL_INTERVAL = 60000; // Refresh every 60 seconds

  function getAppUrl() {
    const scriptTag = document.querySelector('script[src*="loyalty-widget"]');
    // Default app URL - in production this would be configured via settings
    return window.__NEXIFY_APP_URL || 'https://app.example.com';
  }

  function getShopId() {
    return window.Shopify && window.Shopify.shop
      ? window.Shopify.shop
      : null;
  }

  function getCustomerId() {
    // Shopify exposes customer ID on the window in some themes
    if (window.__st && window.__st.cid) {
      return window.__st.cid;
    }
    // Try meta tag
    const meta = document.querySelector('meta[name="nexify-customer-id"]');
    if (meta) return meta.getAttribute('content');
    return null;
  }

  async function fetchBalance(appUrl, shopId, customerId) {
    try {
      const url = `${appUrl}/api/loyalty/balance?shopId=${encodeURIComponent(shopId)}&customerId=${encodeURIComponent(customerId)}`;
      const response = await fetch(url);
      if (!response.ok) return null;
      return await response.json();
    } catch (err) {
      console.warn('[Nexify Loyalty] Failed to fetch balance:', err.message);
      return null;
    }
  }

  function renderWidget(data) {
    const widget = document.getElementById(WIDGET_ID);
    if (!widget) return;

    const pointsEl = document.getElementById('nexify-loyalty-points');
    const rewardEl = document.getElementById('nexify-loyalty-reward');
    const tierEl = document.getElementById('nexify-loyalty-tier');
    const tierNameEl = document.getElementById('nexify-loyalty-tier-name');

    if (pointsEl) pointsEl.textContent = data.points.toLocaleString();
    if (rewardEl) rewardEl.textContent = '$' + data.rewardValue.toFixed(2);

    if (data.tier && tierEl && tierNameEl) {
      tierNameEl.textContent = data.tier;
      tierEl.style.display = 'block';
    }

    widget.style.display = 'block';
  }

  function renderReferralSection(referralCode, shopId, appUrl) {
    const section = document.getElementById('nexify-referral-section');
    if (!section) return;

    const referralLink = `${appUrl}/api/referral?code=${encodeURIComponent(referralCode)}&shop=${encodeURIComponent(shopId)}`;

    const linkInput = document.getElementById('nexify-referral-link');
    if (linkInput) {
      linkInput.value = referralLink;
    }

    // Copy button
    const copyBtn = document.getElementById('nexify-referral-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(referralLink).then(function () {
            copyBtn.textContent = '✓';
            setTimeout(function () { copyBtn.textContent = '📋'; }, 2000);
          });
        } else {
          // Fallback for older browsers
          linkInput.select();
          document.execCommand('copy');
          copyBtn.textContent = '✓';
          setTimeout(function () { copyBtn.textContent = '📋'; }, 2000);
        }
      });
    }

    // Email share button
    const emailBtn = document.getElementById('nexify-referral-email');
    if (emailBtn) {
      emailBtn.addEventListener('click', function () {
        const subject = encodeURIComponent('Check out this store!');
        const body = encodeURIComponent('Hey! I thought you might like this store. Use my referral link to get a discount: ' + referralLink);
        window.open('mailto:?subject=' + subject + '&body=' + body, '_blank');
      });
    }

    // WhatsApp share button
    const whatsappBtn = document.getElementById('nexify-referral-whatsapp');
    if (whatsappBtn) {
      whatsappBtn.addEventListener('click', function () {
        const text = encodeURIComponent('Hey! Check out this store and get a discount with my referral link: ' + referralLink);
        window.open('https://wa.me/?text=' + text, '_blank');
      });
    }

    section.style.display = 'block';
  }

  async function init() {
    var appUrl = getAppUrl();
    var shopId = getShopId();
    var customerId = getCustomerId();

    if (!shopId || !customerId) {
      // No customer logged in — hide widget
      return;
    }

    var data = await fetchBalance(appUrl, shopId, customerId);
    if (data && typeof data.points === 'number') {
      renderWidget(data);

      // If customer has a referral code, show the referral section
      if (data.referralCode) {
        renderReferralSection(data.referralCode, shopId, appUrl);
      }
    }

    // Poll for updates
    setInterval(async function () {
      var freshData = await fetchBalance(appUrl, shopId, customerId);
      if (freshData && typeof freshData.points === 'number') {
        renderWidget(freshData);
      }
    }, POLL_INTERVAL);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

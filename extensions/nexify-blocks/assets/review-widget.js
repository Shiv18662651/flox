/**
 * Nexify Product Reviews - Theme App Extension
 *
 * Fetches and displays approved product reviews on the storefront.
 * Renders aggregate star rating, individual reviews with stars,
 * reviewer name, verified purchase badge, body, and photo thumbnails.
 */
(function () {
  "use strict";

  const REVIEWS_PER_PAGE = 10;

  /** State */
  let currentPage = 1;
  let totalPages = 1;
  let appUrl = "";
  let shopId = "";
  let productId = "";
  let votedReviews = new Set();

  /** Initialize the widget */
  function init() {
    const container = document.getElementById("nexify-reviews");
    if (!container) return;

    appUrl = (container.dataset.appUrl || "").replace(/\/$/, "");
    shopId = container.dataset.shopId || "";
    productId = container.dataset.productId || "";

    if (!appUrl || !shopId || !productId) {
      showError("Review widget configuration is incomplete.");
      return;
    }

    // Load voted reviews from localStorage
    try {
      const stored = localStorage.getItem("nexify_helpful_votes");
      if (stored) {
        votedReviews = new Set(JSON.parse(stored));
      }
    } catch (e) {
      // Ignore localStorage errors
    }

    fetchReviews(1);
  }

  /** Fetch reviews from the public API */
  function fetchReviews(page) {
    currentPage = page;
    const url =
      appUrl +
      "/api/reviews/public?shopId=" +
      encodeURIComponent(shopId) +
      "&productId=" +
      encodeURIComponent(productId) +
      "&page=" +
      page +
      "&limit=" +
      REVIEWS_PER_PAGE;

    fetch(url)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Failed to fetch reviews");
        }
        return response.json();
      })
      .then(function (data) {
        totalPages = data.totalPages || 1;
        renderSummary(data.averageRating, data.totalCount);
        renderReviews(data.reviews);
        renderPagination(data.page, data.totalPages);
      })
      .catch(function () {
        showError("Unable to load reviews at this time.");
      });
  }

  /** Render aggregate rating summary */
  function renderSummary(averageRating, totalCount) {
    var summaryEl = document.getElementById("nexify-reviews-summary");
    if (!summaryEl) return;

    if (totalCount === 0) {
      summaryEl.innerHTML =
        '<span class="nexify-reviews__total-count">No reviews yet</span>';
      return;
    }

    var html =
      '<span class="nexify-reviews__aggregate-rating">' +
      averageRating.toFixed(1) +
      "</span>";
    html +=
      '<span class="nexify-reviews__aggregate-stars">' +
      renderStars(averageRating) +
      "</span>";
    html +=
      '<span class="nexify-reviews__total-count">Based on ' +
      totalCount +
      (totalCount === 1 ? " review" : " reviews") +
      "</span>";

    summaryEl.innerHTML = html;
  }

  /** Render the list of reviews */
  function renderReviews(reviews) {
    var listEl = document.getElementById("nexify-reviews-list");
    if (!listEl) return;

    if (!reviews || reviews.length === 0) {
      listEl.innerHTML =
        '<div class="nexify-reviews__empty">No reviews yet. Be the first to leave a review!</div>';
      return;
    }

    var html = "";
    for (var i = 0; i < reviews.length; i++) {
      html += renderReviewCard(reviews[i]);
    }
    listEl.innerHTML = html;

    // Attach event listeners for helpful buttons and photos
    attachEventListeners(listEl);
  }

  /** Render a single review card */
  function renderReviewCard(review) {
    var html = '<div class="nexify-review" data-review-id="' + review.id + '">';

    // Header: stars, reviewer name, badge, date
    html += '<div class="nexify-review__header">';
    html += '<div class="nexify-review__meta">';
    html +=
      '<span class="nexify-review__stars">' +
      renderStars(review.rating) +
      "</span>";
    html +=
      '<span class="nexify-review__reviewer">' +
      escapeHtml(review.reviewerName) +
      "</span>";

    if (review.verifiedPurchase) {
      html += '<span class="nexify-review__badge">';
      html += '<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">';
      html +=
        '<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>';
      html += "</svg>";
      html += "Verified Purchase</span>";
    }

    html += "</div>"; // .nexify-review__meta

    html +=
      '<span class="nexify-review__date">' +
      formatDate(review.createdAt) +
      "</span>";
    html += "</div>"; // .nexify-review__header

    // Title
    if (review.title) {
      html +=
        '<div class="nexify-review__title">' +
        escapeHtml(review.title) +
        "</div>";
    }

    // Body
    if (review.body) {
      html +=
        '<div class="nexify-review__body">' +
        escapeHtml(review.body) +
        "</div>";
    }

    // Photos
    if (review.photos && review.photos.length > 0) {
      html += '<div class="nexify-review__photos">';
      for (var j = 0; j < review.photos.length; j++) {
        html +=
          '<img class="nexify-review__photo" src="' +
          escapeHtml(review.photos[j]) +
          '" alt="Review photo ' +
          (j + 1) +
          '" loading="lazy" />';
      }
      html += "</div>";
    }

    // Footer: helpful button
    html += '<div class="nexify-review__footer">';
    var hasVoted = votedReviews.has(review.id);
    html +=
      '<button class="nexify-review__helpful-btn' +
      (hasVoted ? " nexify-review__helpful-btn--voted" : "") +
      '" data-review-id="' +
      review.id +
      '"' +
      (hasVoted ? " disabled" : "") +
      ">";
    html +=
      '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">';
    html +=
      '<path d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" transform="scale(0.83)"/>';
    html += "</svg>";
    html += "Helpful";
    html += "</button>";

    if (review.helpfulCount > 0) {
      html +=
        '<span class="nexify-review__helpful-count">' +
        review.helpfulCount +
        (review.helpfulCount === 1 ? " person" : " people") +
        " found this helpful</span>";
    }

    html += "</div>"; // .nexify-review__footer
    html += "</div>"; // .nexify-review

    return html;
  }

  /** Render star SVGs */
  function renderStars(rating) {
    var html = "";
    for (var i = 1; i <= 5; i++) {
      if (i <= Math.floor(rating)) {
        // Full star
        html +=
          '<svg class="nexify-review__star nexify-review__star--filled" viewBox="0 0 20 20" fill="currentColor">';
        html +=
          '<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>';
        html += "</svg>";
      } else if (i - 0.5 <= rating) {
        // Half star
        html +=
          '<svg class="nexify-review__star nexify-review__star--filled" viewBox="0 0 20 20">';
        html += "<defs>";
        html += '<linearGradient id="half-star-' + i + '">';
        html += '<stop offset="50%" stop-color="currentColor"/>';
        html += '<stop offset="50%" stop-color="#d1d5db"/>';
        html += "</linearGradient>";
        html += "</defs>";
        html +=
          '<path fill="url(#half-star-' +
          i +
          ')" d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>';
        html += "</svg>";
      } else {
        // Empty star
        html +=
          '<svg class="nexify-review__star nexify-review__star--empty" viewBox="0 0 20 20" fill="currentColor">';
        html +=
          '<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>';
        html += "</svg>";
      }
    }
    return html;
  }

  /** Render pagination controls */
  function renderPagination(page, total) {
    var paginationEl = document.getElementById("nexify-reviews-pagination");
    if (!paginationEl || total <= 1) {
      if (paginationEl) paginationEl.innerHTML = "";
      return;
    }

    var html = "";
    html +=
      '<button class="nexify-reviews__page-btn" data-page="' +
      (page - 1) +
      '"' +
      (page <= 1 ? " disabled" : "") +
      ">&laquo; Previous</button>";
    html +=
      '<span class="nexify-reviews__page-info">Page ' +
      page +
      " of " +
      total +
      "</span>";
    html +=
      '<button class="nexify-reviews__page-btn" data-page="' +
      (page + 1) +
      '"' +
      (page >= total ? " disabled" : "") +
      ">Next &raquo;</button>";

    paginationEl.innerHTML = html;

    // Attach pagination click handlers
    var buttons = paginationEl.querySelectorAll(".nexify-reviews__page-btn");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener("click", function (e) {
        var targetPage = parseInt(e.currentTarget.dataset.page, 10);
        if (targetPage >= 1 && targetPage <= totalPages) {
          fetchReviews(targetPage);
          // Scroll to top of reviews section
          var container = document.getElementById("nexify-reviews");
          if (container) {
            container.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      });
    }
  }

  /** Attach event listeners for helpful buttons and photo lightbox */
  function attachEventListeners(listEl) {
    // Helpful buttons
    var helpfulBtns = listEl.querySelectorAll(".nexify-review__helpful-btn");
    for (var i = 0; i < helpfulBtns.length; i++) {
      helpfulBtns[i].addEventListener("click", handleHelpfulClick);
    }

    // Photo lightbox
    var photos = listEl.querySelectorAll(".nexify-review__photo");
    for (var j = 0; j < photos.length; j++) {
      photos[j].addEventListener("click", handlePhotoClick);
    }
  }

  /** Handle helpful button click */
  function handleHelpfulClick(e) {
    var btn = e.currentTarget;
    var reviewId = btn.dataset.reviewId;

    if (votedReviews.has(reviewId)) return;

    btn.disabled = true;
    btn.classList.add("nexify-review__helpful-btn--voted");

    fetch(appUrl + "/api/reviews/helpful", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId: reviewId }),
    })
      .then(function (response) {
        if (response.ok) {
          votedReviews.add(reviewId);
          try {
            localStorage.setItem(
              "nexify_helpful_votes",
              JSON.stringify(Array.from(votedReviews)),
            );
          } catch (e) {
            // Ignore localStorage errors
          }
        }
      })
      .catch(function () {
        // Revert on failure
        btn.disabled = false;
        btn.classList.remove("nexify-review__helpful-btn--voted");
      });
  }

  /** Handle photo click - open lightbox */
  function handlePhotoClick(e) {
    var src = e.currentTarget.src;
    var lightbox = document.createElement("div");
    lightbox.className = "nexify-reviews__lightbox";
    lightbox.innerHTML = '<img src="' + src + '" alt="Review photo enlarged" />';
    lightbox.addEventListener("click", function () {
      document.body.removeChild(lightbox);
    });
    document.body.appendChild(lightbox);
  }

  /** Show error message */
  function showError(message) {
    var listEl = document.getElementById("nexify-reviews-list");
    var summaryEl = document.getElementById("nexify-reviews-summary");
    if (summaryEl) summaryEl.innerHTML = "";
    if (listEl) {
      listEl.innerHTML =
        '<div class="nexify-reviews__error">' + escapeHtml(message) + "</div>";
    }
  }

  /** Format date to readable string */
  function formatDate(isoString) {
    try {
      var date = new Date(isoString);
      var now = new Date();
      var diffMs = now - date;
      var diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return "Today";
      if (diffDays === 1) return "Yesterday";
      if (diffDays < 7) return diffDays + " days ago";
      if (diffDays < 30) return Math.floor(diffDays / 7) + " weeks ago";

      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (e) {
      return "";
    }
  }

  /** Escape HTML to prevent XSS */
  function escapeHtml(str) {
    if (!str) return "";
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

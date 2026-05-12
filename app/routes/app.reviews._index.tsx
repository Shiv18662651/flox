// Reviews Dashboard — Product Reviews UI
// Requirements: 7.x

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useSubmit, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { Icon, StarRow } from "~/components/Icon";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Sentiment = "positive" | "neutral" | "negative";
type ReviewStatus = "pending" | "approved" | "rejected";

interface MockReview {
  id: string;
  reviewer: { name: string; initials: string; timeAgo: string };
  rating: number;
  productTitle: string;
  productUrl: string;
  sentiment: Sentiment;
  title: string;
  body: string;
  photo: string | null;
  status: ReviewStatus;
}

// ---------------------------------------------------------------------------
// Loader — mock data
// ---------------------------------------------------------------------------

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const tab = (url.searchParams.get("tab") || "all") as "all" | ReviewStatus;
  const search = url.searchParams.get("q") || "";
  const starFilter = url.searchParams.get("stars") || "";

  const allReviews: MockReview[] = [
    {
      id: "rev_001",
      reviewer: { name: "Sarah Miller", initials: "SM", timeAgo: "2 hours ago" },
      rating: 5,
      productTitle: "Premium Wireless Headphones",
      productUrl: "#",
      sentiment: "positive",
      title: "Absolutely love these headphones!",
      body: "The sound quality is incredible and the noise cancellation works perfectly. I've been using them daily for the past month and they still feel brand new. Battery life is outstanding — easily 30+ hours on a single charge. Highly recommend to anyone looking for premium audio.",
      photo: null,
      status: "approved",
    },
    {
      id: "rev_002",
      reviewer: { name: "James Doe", initials: "JD", timeAgo: "1 day ago" },
      rating: 3,
      productTitle: "Ergonomic Office Chair",
      productUrl: "#",
      sentiment: "neutral",
      title: "Decent chair, some assembly issues",
      body: "The chair is comfortable enough for long work sessions. Assembly instructions were a bit confusing and one of the bolts was missing from the package. Customer support was helpful and sent a replacement quickly. Overall it does the job but the assembly experience could be better.",
      photo: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=80&h=80&fit=crop",
      status: "pending",
    },
    {
      id: "rev_003",
      reviewer: { name: "Anna Lee", initials: "AL", timeAgo: "3 days ago" },
      rating: 1,
      productTitle: "Organic Skincare Set",
      productUrl: "#",
      sentiment: "negative",
      title: "Very disappointed with this product",
      body: "The product arrived damaged and the packaging was completely crushed. The serum inside had leaked all over the box. I contacted support but haven't heard back in 5 days. This is not acceptable for a premium-priced skincare set. I would not recommend purchasing this.",
      photo: null,
      status: "rejected",
    },
  ];

  // Filter
  let filtered = allReviews;
  if (tab !== "all") filtered = filtered.filter((r) => r.status === tab);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.reviewer.name.toLowerCase().includes(q) ||
        r.productTitle.toLowerCase().includes(q) ||
        r.body.toLowerCase().includes(q)
    );
  }
  if (starFilter) {
    const stars = parseInt(starFilter, 10);
    if (!isNaN(stars)) filtered = filtered.filter((r) => r.rating === stars);
  }

  const PAGE_SIZE = 10;
  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const reviews = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return json({
    reviews,
    totalCount,
    page,
    totalPages,
    tab,
    search,
    starFilter,
    stats: {
      total: 1204,
      avgRating: 4.8,
      pending: 12,
      photoReviews: 340,
    },
  });
}

// ---------------------------------------------------------------------------
// Action — approve / reject / delete
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const reviewId = formData.get("reviewId") as string;

  if (!reviewId) return json({ error: "Review ID required" }, { status: 400 });

  // In production this would hit the DB. With mock data we just echo success.
  switch (intent) {
    case "approve":
      return json({ success: true, message: "Review approved and published." });
    case "reject":
      return json({ success: true, message: "Review rejected." });
    case "delete":
      return json({ success: true, message: "Review deleted." });
    default:
      return json({ error: "Invalid action" }, { status: 400 });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------



function SentimentBadge({ sentiment }: { sentiment: Sentiment }) {
  const map: Record<Sentiment, { label: string; classes: string; icon: string }> = {
    positive: { label: "Positive", classes: "bg-secondary-container text-on-secondary-container", icon: "sentiment_satisfied" },
    neutral: { label: "Neutral", classes: "bg-surface-container-high text-on-surface-variant", icon: "sentiment_neutral" },
    negative: { label: "Negative", classes: "bg-error-container text-on-error-container", icon: "sentiment_dissatisfied" },
  };
  const { label, classes, icon } = map[sentiment];
  return (
    <span className={`inline-flex items-center gap-[4px] px-2 py-0.5 rounded-full text-label-sm font-semibold ${classes}`}>
      <Icon name={icon} size={12} />
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  const map: Record<ReviewStatus, { label: string; classes: string }> = {
    approved: { label: "Approved", classes: "bg-secondary-container text-on-secondary-container" },
    pending: { label: "Pending", classes: "bg-tertiary-fixed text-on-tertiary-fixed-variant" },
    rejected: { label: "Rejected", classes: "bg-error-container text-on-error-container" },
  };
  const { label, classes } = map[status];
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-label-sm font-semibold ${classes}`}>
      {label}
    </span>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: string;
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-md border shadow-sm flex flex-col gap-xs ${
        accent
          ? "bg-tertiary-fixed border-tertiary-fixed-dim"
          : "bg-surface-container-lowest border-outline-variant"
      }`}
    >
      <div className="flex items-center justify-between">
        <Icon name={icon} size={22} className={accent ? "text-on-tertiary-fixed-variant" : "text-primary"} />
      </div>
      <p className={`text-label-md ${accent ? "text-on-tertiary-fixed-variant" : "text-on-surface-variant"}`}>
        {label}
      </p>
      <div className={`text-headline-md font-bold ${accent ? "text-on-tertiary-fixed-variant" : "text-on-surface"}`}>
        {value}
      </div>
      {sub && (
        <p className={`text-label-sm ${accent ? "text-on-tertiary-fixed-variant opacity-70" : "text-on-surface-variant"}`}>
          {sub}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ReviewsDashboard() {
  const { reviews, totalCount, page, totalPages, tab, search, starFilter, stats } =
    useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";
  const [localSearch, setLocalSearch] = useState(search);

  const updateParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      if (value) prev.set(key, value);
      else prev.delete(key);
      prev.delete("page");
      return prev;
    });
  };

  const handleAction = (intent: string, reviewId: string) => {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("reviewId", reviewId);
    submit(fd, { method: "post" });
  };

  const tabs: { key: "all" | ReviewStatus; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <main className="p-lg max-w-container-max mx-auto font-sans pb-24">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-md mb-lg">
        <div>
          <h1 className="text-display-lg font-bold text-on-surface">Reviews</h1>
          <p className="text-body-lg text-on-surface-variant mt-xs">
            Moderate and manage customer product reviews.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-xs bg-primary text-on-primary text-label-md font-semibold px-md py-xs rounded-lg hover:opacity-90 transition-opacity shadow-sm self-start sm:self-auto"
        >
          <Icon name="add" size={18} />
          Primary Action
        </button>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-md mb-lg">
        <StatCard
          icon="reviews"
          label="Total Reviews"
          value={stats.total.toLocaleString()}
          sub="All time"
        />
        <StatCard
          icon="star"
          label="Avg Rating"
          value={
            <span className="flex items-center gap-xs">
              <span>{stats.avgRating}</span>
              <StarRow rating={Math.round(stats.avgRating)} size="md" />
            </span>
          }
          sub="Out of 5.0"
        />
        <StatCard
          icon="pending"
          label="Pending Approval"
          value={stats.pending}
          sub="Awaiting review"
          accent
        />
        <StatCard
          icon="photo_library"
          label="Photo Reviews"
          value={stats.photoReviews.toLocaleString()}
          sub="With images"
        />
      </div>

      {/* ── Filter Bar ── */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-sm mb-md shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-sm">
          {/* Tab buttons */}
          <div className="flex items-center gap-xs bg-surface-container rounded-lg p-[3px]">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => updateParam("tab", t.key === "all" ? "" : t.key)}
                className={`px-sm py-[6px] rounded-md text-label-md font-semibold transition-colors ${
                  tab === t.key
                    ? "bg-surface-container-lowest text-primary shadow-sm"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 flex flex-col sm:flex-row gap-sm">
            {/* Search */}
            <div className="relative flex-1">
              <Icon name="search" size={18} className="absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <input
                type="search"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") updateParam("q", localSearch);
                }}
                onBlur={() => updateParam("q", localSearch)}
                placeholder="Search reviews…"
                className="w-full pl-[36px] pr-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition"
                aria-label="Search reviews"
              />
            </div>

            {/* Star rating select */}
            <div className="relative">
              <Icon name="star" size={18} className="absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <select
                value={starFilter}
                onChange={(e) => updateParam("stars", e.target.value)}
                className="pl-[36px] pr-md py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition appearance-none cursor-pointer"
                aria-label="Filter by star rating"
              >
                <option value="">All Stars</option>
                {[5, 4, 3, 2, 1].map((s) => (
                  <option key={s} value={String(s)}>
                    {s} Star{s !== 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ── Reviews DataTable ── */}
      <div
        className={`bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden transition-opacity ${
          isLoading ? "opacity-60" : "opacity-100"
        }`}
      >
        {/* Table header */}
        <div className="hidden lg:grid grid-cols-[2fr_2fr_1fr_3fr_auto] gap-md px-md py-sm border-b border-outline-variant bg-surface-container-low">
          {["Reviewer", "Rating & Product", "Sentiment", "Content", "Actions"].map((h) => (
            <span key={h} className="text-label-md font-semibold text-on-surface-variant">
              {h}
            </span>
          ))}
        </div>

        {reviews.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-xl gap-sm text-on-surface-variant">
            <Icon name="rate_review" size={48} className="opacity-40" />
            <p className="text-body-lg font-medium">No reviews found</p>
            <p className="text-body-md">Try adjusting your filters.</p>
          </div>
        ) : (
          <div className="divide-y divide-outline-variant">
            {reviews.map((review) => (
              <ReviewRow key={review.id} review={review} onAction={handleAction} />
            ))}
          </div>
        )}
      </div>

      {/* ── Pagination Footer ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-md px-xs">
          <p className="text-body-md text-on-surface-variant">
            Page <span className="font-semibold text-on-surface">{page}</span> of{" "}
            <span className="font-semibold text-on-surface">{totalPages}</span>
            {" "}— {totalCount} review{totalCount !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-xs">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => updateParam("page", String(page - 1))}
              className="inline-flex items-center gap-[4px] px-sm py-xs rounded-lg border border-outline-variant text-label-md font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Icon name="chevron_left" size={18} />
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => updateParam("page", String(page + 1))}
              className="inline-flex items-center gap-[4px] px-sm py-xs rounded-lg border border-outline-variant text-label-md font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <Icon name="chevron_right" size={18} />
            </button>
          </div>
        </div>
      )}

      {/* ── FAB ── */}
      <button
        type="button"
        className="fixed bottom-6 right-6 z-50 flex items-center gap-xs bg-primary text-on-primary px-md py-sm rounded-full shadow-lg hover:opacity-90 active:scale-95 transition-all text-label-md font-semibold"
        aria-label="Request reviews"
      >
        <Icon name="add_comment" size={20} />
        Request Reviews
      </button>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Review Row
// ---------------------------------------------------------------------------

function ReviewRow({
  review,
  onAction,
}: {
  review: MockReview;
  onAction: (intent: string, reviewId: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr_2fr_1fr_3fr_auto] gap-md px-md py-sm items-start hover:bg-surface-container-low transition-colors">
      {/* Reviewer */}
      <div className="flex items-start gap-sm">
        <div
          className="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center shrink-0 text-on-primary-container text-label-md font-bold"
          aria-hidden="true"
        >
          {review.reviewer.initials}
        </div>
        <div className="min-w-0">
          <p className="text-body-md font-semibold text-on-surface truncate">
            {review.reviewer.name}
          </p>
          <p className="text-label-sm text-on-surface-variant">{review.reviewer.timeAgo}</p>
          <div className="mt-[2px] lg:hidden">
            <StatusBadge status={review.status} />
          </div>
        </div>
      </div>

      {/* Rating & Product */}
      <div className="flex flex-col gap-[4px]">
        <StarRow rating={review.rating} />
        <a
          href={review.productUrl}
          className="text-body-md text-primary hover:underline truncate max-w-[200px] inline-block"
        >
          {review.productTitle}
        </a>
        <div className="hidden lg:block mt-[2px]">
          <StatusBadge status={review.status} />
        </div>
      </div>

      {/* Sentiment */}
      <div className="flex items-start">
        <SentimentBadge sentiment={review.sentiment} />
      </div>

      {/* Content */}
      <div className="flex items-start gap-sm min-w-0">
        <div className="flex-1 min-w-0">
          <p className="text-body-md font-semibold text-on-surface mb-[2px]">{review.title}</p>
          <p className="text-body-md text-on-surface-variant line-clamp-3">{review.body}</p>
        </div>
        {review.photo && (
          <img
            src={review.photo}
            alt="Review photo"
            className="w-14 h-14 rounded-lg object-cover border border-outline-variant shrink-0"
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-row lg:flex-col gap-xs items-start">
        {review.status !== "approved" && (
          <button
            type="button"
            onClick={() => onAction("approve", review.id)}
            className="inline-flex items-center gap-[4px] px-sm py-[5px] rounded-lg bg-secondary-container text-on-secondary-container text-label-sm font-semibold hover:opacity-80 transition-opacity"
            aria-label={`Approve review by ${review.reviewer.name}`}
          >
            <Icon name="check_circle" size={14} />
            Approve
          </button>
        )}
        {review.status !== "rejected" && (
          <button
            type="button"
            onClick={() => onAction("reject", review.id)}
            className="inline-flex items-center gap-[4px] px-sm py-[5px] rounded-lg border border-outline-variant text-on-surface-variant text-label-sm font-semibold hover:bg-surface-container transition-colors"
            aria-label={`Reject review by ${review.reviewer.name}`}
          >
            <Icon name="block" size={14} />
            Reject
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (confirm("Delete this review? This cannot be undone.")) {
              onAction("delete", review.id);
            }
          }}
          className="inline-flex items-center gap-[4px] px-sm py-[5px] rounded-lg border border-error-container text-error text-label-sm font-semibold hover:bg-error-container transition-colors"
          aria-label={`Delete review by ${review.reviewer.name}`}
        >
          <Icon name="delete" size={14} />
          Delete
        </button>
      </div>
    </div>
  );
}

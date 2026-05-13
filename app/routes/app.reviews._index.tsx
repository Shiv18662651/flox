// Reviews Dashboard — Real DB-backed
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { Icon, StarRow } from "~/components/Icon";
import { generateReviewSummary } from "~/ai.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabFilter = "all" | "pending" | "approved" | "rejected";

interface AiSummary {
  summary: string;
  pros: string[];
  cons: string[];
  sentiment: "positive" | "neutral" | "negative";
}

interface ReviewItem {
  id: string;
  customer: { firstName: string | null; lastName: string | null; email: string | null } | null;
  rating: number;
  productTitle: string;
  shopifyProductId: string;
  sentiment: string | null;
  title: string | null;
  body: string | null;
  photos: string[];
  isApproved: boolean;
  isPublished: boolean;
  isPinned: boolean;
  merchantReply: string | null;
  repliedAt: string | null;
  helpfulCount: number;
  verifiedPurchase: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStatus(isApproved: boolean, isPublished: boolean): { key: TabFilter; label: string; classes: string } {
  if (!isApproved && !isPublished) return { key: "pending", label: "Pending", classes: "bg-tertiary-fixed text-on-tertiary-fixed-variant" };
  if (isApproved && isPublished) return { key: "approved", label: "Approved", classes: "bg-secondary-container text-on-secondary-container" };
  return { key: "rejected", label: "Rejected", classes: "bg-error-container text-on-error-container" };
}

function computeSentiment(rating: number, dbSentiment: string | null): "positive" | "neutral" | "negative" {
  if (dbSentiment === "positive" || dbSentiment === "neutral" || dbSentiment === "negative") return dbSentiment;
  if (rating >= 4) return "positive";
  if (rating === 3) return "neutral";
  return "negative";
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function reviewerName(customer: ReviewItem["customer"]): string {
  if (!customer) return "Anonymous";
  const first = customer.firstName || "";
  const last = customer.lastName || "";
  if (first && last) return `${first} ${last.charAt(0)}.`;
  return first || last || "Anonymous";
}

function initials(customer: ReviewItem["customer"]): string {
  if (!customer) return "A";
  const f = (customer.firstName || "").charAt(0);
  const l = (customer.lastName || "").charAt(0);
  return (f + l) || "A";
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({ where: { shopDomain }, select: { id: true } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const tab = (url.searchParams.get("tab") || "all") as TabFilter;
  const search = url.searchParams.get("q") || "";
  const starFilter = url.searchParams.get("stars") || "";
  const PAGE_SIZE = 10;

  // Build where clause
  const where: Record<string, unknown> = { shopId: shop.id };
  if (tab === "pending") { where.isApproved = false; }
  else if (tab === "approved") { where.isApproved = true; where.isPublished = true; }
  else if (tab === "rejected") { where.isApproved = true; where.isPublished = false; }

  if (starFilter) {
    const s = parseInt(starFilter, 10);
    if (!isNaN(s)) where.rating = s;
  }

  // Count
  const totalCount = await db.review.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Fetch reviews
  const rawReviews = await db.review.findMany({
    where,
    include: { customer: { select: { firstName: true, lastName: true, email: true } } },
    orderBy: [{ isPinned: "desc" as const }, { createdAt: "desc" as const }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  // Filter by search locally (Prisma OR with relations is verbose)
  let reviews = rawReviews;
  if (search.trim()) {
    const q = search.toLowerCase();
    reviews = rawReviews.filter((r) =>
      (r.title || "").toLowerCase().includes(q) ||
      (r.body || "").toLowerCase().includes(q) ||
      (r.productTitle || "").toLowerCase().includes(q) ||
      (r.customer?.firstName || "").toLowerCase().includes(q) ||
      (r.customer?.lastName || "").toLowerCase().includes(q)
    );
  }

  const reviewItems: ReviewItem[] = reviews.map((r) => ({
    id: r.id,
    customer: r.customer,
    rating: r.rating,
    productTitle: r.productTitle,
    shopifyProductId: r.shopifyProductId,
    sentiment: r.sentiment,
    title: r.title,
    body: r.body,
    photos: r.photos || [],
    isApproved: r.isApproved,
    isPublished: r.isPublished,
    isPinned: r.isPinned,
    merchantReply: r.merchantReply,
    repliedAt: r.repliedAt?.toISOString() || null,
    helpfulCount: r.helpfulCount,
    verifiedPurchase: r.verifiedPurchase,
    createdAt: r.createdAt.toISOString(),
  }));

  // Stats
  const [total, avgAgg, pendingCount, photoCount] = await Promise.all([
    db.review.count({ where: { shopId: shop.id } }),
    db.review.aggregate({ where: { shopId: shop.id, isPublished: true }, _avg: { rating: true } }),
    db.review.count({ where: { shopId: shop.id, isApproved: false } }),
    db.review.count({ where: { shopId: shop.id, NOT: { photos: { equals: [] } } } }),
  ]);
  const avgRating = avgAgg._avg.rating ? parseFloat(avgAgg._avg.rating.toFixed(1)) : 0;

  // AI summary for published reviews
  let aiSummary: AiSummary | null = null;
  try {
    const publishedForSummary = await db.review.findMany({
      where: { shopId: shop.id, isPublished: true },
      select: { rating: true, title: true, body: true, verifiedPurchase: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    if (publishedForSummary.length >= 3) {
      aiSummary = await generateReviewSummary(publishedForSummary);
    }
  } catch {
    aiSummary = null;
  }

  return json({
    reviews: reviewItems,
    totalCount,
    page,
    totalPages,
    tab,
    search,
    starFilter,
    stats: { total, avgRating, pending: pendingCount, photoReviews: photoCount },
    aiSummary,
  });
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await db.shop.findUnique({ where: { shopDomain }, select: { id: true } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const reviewId = formData.get("reviewId") as string;

  if (!reviewId) return json({ error: "Review ID required" }, { status: 400 });

  const review = await db.review.findFirst({ where: { id: reviewId, shopId: shop.id } });
  if (!review) return json({ error: "Review not found" }, { status: 404 });

  switch (intent) {
    case "approve":
      await db.review.update({ where: { id: reviewId }, data: { isApproved: true, isPublished: true } });
      return json({ success: true, message: "Review approved and published." });
    case "reject":
      await db.review.update({ where: { id: reviewId }, data: { isApproved: true, isPublished: false } });
      return json({ success: true, message: "Review rejected." });
    case "delete":
      await db.review.delete({ where: { id: reviewId } });
      return json({ success: true, message: "Review deleted." });
    case "reply": {
      const replyText = (formData.get("reply") as string) || "";
      await db.review.update({
        where: { id: reviewId },
        data: { merchantReply: replyText || null, repliedAt: replyText ? new Date() : null },
      });
      return json({ success: true, message: replyText ? "Reply posted." : "Reply removed." });
    }
    case "pin": {
      await db.review.update({ where: { id: reviewId }, data: { isPinned: !review.isPinned } });
      return json({ success: true, message: review.isPinned ? "Review unpinned." : "Review pinned." });
    }
    default:
      return json({ error: "Invalid action" }, { status: 400 });
  }
}

// ---------------------------------------------------------------------------
// UI Components
// ---------------------------------------------------------------------------

function SentimentBadge({ sentiment }: { sentiment: "positive" | "neutral" | "negative" }) {
  const map = {
    positive: { label: "Positive", classes: "bg-secondary-container text-on-secondary-container", icon: "sentiment_satisfied" as const },
    neutral: { label: "Neutral", classes: "bg-surface-container-high text-on-surface-variant", icon: "sentiment_neutral" as const },
    negative: { label: "Negative", classes: "bg-error-container text-on-error-container", icon: "sentiment_dissatisfied" as const },
  };
  const { label, classes, icon } = map[sentiment];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label-sm font-semibold ${classes}`}>
      <Icon name={icon} size={12} />
      {label}
    </span>
  );
}

function StatusBadge({ isApproved, isPublished }: { isApproved: boolean; isPublished: boolean }) {
  const s = getStatus(isApproved, isPublished);
  return <span className={`inline-block px-2 py-0.5 rounded-full text-label-sm font-semibold ${s.classes}`}>{s.label}</span>;
}

function StatCard({ icon, label, value, sub, accent }: { icon: string; label: string; value: React.ReactNode; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl p-md border shadow-sm flex flex-col gap-xs ${accent ? "bg-tertiary-fixed border-tertiary-fixed-dim" : "bg-surface-container-lowest border-outline-variant"}`}>
      <div className="flex items-center justify-between">
        <Icon name={icon} size={22} className={accent ? "text-on-tertiary-fixed-variant" : "text-primary"} />
      </div>
      <p className={`text-label-md ${accent ? "text-on-tertiary-fixed-variant" : "text-on-surface-variant"}`}>{label}</p>
      <div className={`text-headline-md font-bold ${accent ? "text-on-tertiary-fixed-variant" : "text-on-surface"}`}>{value}</div>
      {sub && <p className={`text-label-sm ${accent ? "text-on-tertiary-fixed-variant opacity-70" : "text-on-surface-variant"}`}>{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ReviewsDashboard() {
  const { reviews, totalCount, page, totalPages, tab, search, starFilter, stats, aiSummary } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [, setSearchParams] = useSearchParams();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";
  const [localSearch, setLocalSearch] = useState(search);
  const [replyModal, setReplyModal] = useState<{ open: boolean; reviewId: string; existing: string }>({ open: false, reviewId: "", existing: "" });

  const updateParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      if (value) prev.set(key, value); else prev.delete(key);
      prev.delete("page");
      return prev;
    });
  };

  const handleAction = (intent: string, reviewId: string, extra?: FormData) => {
    const fd = extra || new FormData();
    fd.set("intent", intent);
    fd.set("reviewId", reviewId);
    submit(fd, { method: "post" });
  };

  const tabs: { key: TabFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <main className="p-lg max-w-container-max mx-auto font-sans pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-md mb-lg">
        <div>
          <h1 className="text-display-lg font-bold text-on-surface">Reviews</h1>
          <p className="text-body-lg text-on-surface-variant mt-xs">Moderate and manage customer product reviews.</p>
        </div>
      </div>

      {/* Alerts */}
      {actionData && "success" in actionData && actionData.success && (
        <div className="mb-md px-sm py-xs rounded-lg bg-secondary-container text-on-secondary-container flex items-center gap-xs text-label-md">
          <Icon name="check_circle" size={16} />
          {actionData.message}
        </div>
      )}
      {actionData && "error" in actionData && actionData.error && (
        <div className="mb-md px-sm py-xs rounded-lg bg-error-container text-on-error-container flex items-center gap-xs text-label-md">
          <Icon name="error" size={16} />
          {actionData.error}
        </div>
      )}

      {/* AI Summary */}
      {aiSummary && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md mb-md shadow-sm">
          <div className="flex items-center gap-xs mb-sm">
            <Icon name="auto_awesome" size={20} className="text-primary" />
            <h2 className="text-headline-sm font-semibold text-on-surface">AI Review Summary</h2>
            <SentimentBadge sentiment={aiSummary.sentiment} />
          </div>
          <p className="text-body-md text-on-surface mb-sm">{aiSummary.summary}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
            {aiSummary.pros.length > 0 && (
              <div>
                <p className="text-label-md font-semibold text-on-surface mb-xs">Pros</p>
                <ul className="space-y-1">
                  {aiSummary.pros.map((pro, i) => (
                    <li key={i} className="flex items-start gap-1 text-body-md text-on-surface-variant">
                      <Icon name="check_circle" size={16} className="text-secondary mt-0.5 shrink-0" />
                      {pro}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {aiSummary.cons.length > 0 && (
              <div>
                <p className="text-label-md font-semibold text-on-surface mb-xs">Cons</p>
                <ul className="space-y-1">
                  {aiSummary.cons.map((con, i) => (
                    <li key={i} className="flex items-start gap-1 text-body-md text-on-surface-variant">
                      <Icon name="cancel" size={16} className="text-error mt-0.5 shrink-0" />
                      {con}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-md mb-lg">
        <StatCard icon="reviews" label="Total Reviews" value={stats.total.toLocaleString()} sub="All time" />
        <StatCard icon="star" label="Avg Rating" value={<span className="flex items-center gap-xs"><span>{stats.avgRating}</span><StarRow rating={Math.round(stats.avgRating)} size="md" /></span>} sub="Out of 5.0" />
        <StatCard icon="pending" label="Pending Approval" value={stats.pending} sub="Awaiting review" accent />
        <StatCard icon="photo_library" label="Photo Reviews" value={stats.photoReviews.toLocaleString()} sub="With images" />
      </div>

      {/* Filters */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-sm mb-md shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-sm">
          <div className="flex items-center gap-xs bg-surface-container rounded-lg p-[3px]">
            {tabs.map((t) => (
              <button key={t.key} type="button" onClick={() => updateParam("tab", t.key === "all" ? "" : t.key)}
                className={`px-sm py-[6px] rounded-md text-label-md font-semibold transition-colors ${tab === t.key ? "bg-surface-container-lowest text-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex-1 flex flex-col sm:flex-row gap-sm">
            <div className="relative flex-1">
              <Icon name="search" size={18} className="absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <input type="search" value={localSearch} onChange={(e) => setLocalSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") updateParam("q", localSearch); }}
                onBlur={() => updateParam("q", localSearch)}
                placeholder="Search reviews…"
                className="w-full pl-9 pr-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition"
              />
            </div>
            <div className="relative">
              <Icon name="star" size={18} className="absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <select value={starFilter} onChange={(e) => updateParam("stars", e.target.value)}
                className="pl-9 pr-md py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition appearance-none cursor-pointer">
                <option value="">All Stars</option>
                {[5, 4, 3, 2, 1].map((s) => <option key={s} value={String(s)}>{s} Star{s !== 1 ? "s" : ""}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className={`bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden transition-opacity ${isLoading ? "opacity-60" : "opacity-100"}`}>
        <div className="hidden lg:grid grid-cols-[2fr_2fr_1fr_3fr_auto] gap-md px-md py-sm border-b border-outline-variant bg-surface-container-low">
          {["Reviewer", "Rating & Product", "Sentiment", "Content", "Actions"].map((h) => (
            <span key={h} className="text-label-md font-semibold text-on-surface-variant">{h}</span>
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
              <ReviewRow key={review.id} review={review} onAction={handleAction} onReply={(id, existing) => setReplyModal({ open: true, reviewId: id, existing })} />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-md px-xs">
          <p className="text-body-md text-on-surface-variant">
            Page <span className="font-semibold text-on-surface">{page}</span> of <span className="font-semibold text-on-surface">{totalPages}</span> — {totalCount} review{totalCount !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-xs">
            <button type="button" disabled={page <= 1} onClick={() => updateParam("page", String(page - 1))}
              className="inline-flex items-center gap-1 px-sm py-xs rounded-lg border border-outline-variant text-label-md font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <Icon name="chevron_left" size={18} /> Previous
            </button>
            <button type="button" disabled={page >= totalPages} onClick={() => updateParam("page", String(page + 1))}
              className="inline-flex items-center gap-1 px-sm py-xs rounded-lg border border-outline-variant text-label-md font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              Next <Icon name="chevron_right" size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Reply Modal */}
      {replyModal.open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-sm">
          <div className="bg-surface-container-lowest rounded-xl shadow-xl max-w-lg w-full p-md space-y-md">
            <div className="flex items-center justify-between">
              <h3 className="text-headline-sm font-semibold text-on-surface">Reply to Review</h3>
              <button type="button" onClick={() => setReplyModal({ open: false, reviewId: "", existing: "" })} className="text-on-surface-variant hover:text-on-surface transition-colors">
                <Icon name="close" size={20} />
              </button>
            </div>
            <textarea
              rows={4}
              defaultValue={replyModal.existing}
              placeholder="Write your public response..."
              className="w-full rounded-lg border border-outline-variant bg-surface px-sm py-xs text-body-md text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition resize-none"
              onChange={(e) => { replyModal.existing = e.target.value; }}
            />
            <div className="flex justify-end gap-xs">
              <button type="button" onClick={() => setReplyModal({ open: false, reviewId: "", existing: "" })}
                className="px-md py-xs rounded-lg border border-outline-variant text-label-md font-semibold text-on-surface hover:bg-surface-container transition-colors">Cancel</button>
              <button type="button" onClick={() => {
                const fd = new FormData();
                fd.set("reply", replyModal.existing);
                handleAction("reply", replyModal.reviewId, fd);
                setReplyModal({ open: false, reviewId: "", existing: "" });
              }}
                className="px-md py-xs rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:opacity-90 transition-opacity">Post Reply</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Review Row
// ---------------------------------------------------------------------------

function ReviewRow({ review, onAction, onReply }: { review: ReviewItem; onAction: (intent: string, reviewId: string, extra?: FormData) => void; onReply: (id: string, existing: string) => void }) {
  const status = getStatus(review.isApproved, review.isPublished);
  const sentiment = computeSentiment(review.rating, review.sentiment);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr_2fr_1fr_3fr_auto] gap-md px-md py-sm items-start hover:bg-surface-container-low transition-colors">
      {/* Reviewer */}
      <div className="flex items-start gap-sm">
        <div className="w-9 h-9 rounded-full bg-primary-container flex items-center justify-center shrink-0 text-on-primary-container text-label-md font-bold" aria-hidden="true">
          {initials(review.customer)}
        </div>
        <div className="min-w-0">
          <p className="text-body-md font-semibold text-on-surface truncate">{reviewerName(review.customer)}</p>
          <p className="text-label-sm text-on-surface-variant">{relativeTime(review.createdAt)}</p>
          <div className="mt-0.5 lg:hidden"><StatusBadge isApproved={review.isApproved} isPublished={review.isPublished} /></div>
        </div>
      </div>

      {/* Rating & Product */}
      <div className="flex flex-col gap-1">
        <StarRow rating={review.rating} />
        <span className="text-body-md text-primary truncate max-w-[200px] inline-block">{review.productTitle}</span>
        <div className="hidden lg:block mt-0.5"><StatusBadge isApproved={review.isApproved} isPublished={review.isPublished} /></div>
      </div>

      {/* Sentiment */}
      <div className="flex items-start"><SentimentBadge sentiment={sentiment} /></div>

      {/* Content */}
      <div className="flex items-start gap-sm min-w-0">
        <div className="flex-1 min-w-0">
          {review.isPinned && (
            <span className="inline-flex items-center gap-1 text-label-sm text-primary font-semibold mb-1">
              <Icon name="push_pin" size={12} /> Pinned
            </span>
          )}
          <p className="text-body-md font-semibold text-on-surface mb-0.5">{review.title || "(No title)"}</p>
          <p className="text-body-md text-on-surface-variant line-clamp-3">{review.body || "(No content)"}</p>
          {review.merchantReply && (
            <div className="mt-2 p-2 rounded-lg bg-primary-container/50 border border-primary-container">
              <p className="text-label-sm text-primary font-semibold mb-0.5">Merchant Response</p>
              <p className="text-body-md text-on-surface">{review.merchantReply}</p>
            </div>
          )}
        </div>
        {review.photos.length > 0 && (
          <div className="flex gap-1 shrink-0">
            {review.photos.slice(0, 3).map((url, i) => (
              <img key={i} src={url} alt={`Photo ${i + 1}`} className="w-14 h-14 rounded-lg object-cover border border-outline-variant" loading="lazy" />
            ))}
            {review.photos.length > 3 && <span className="w-14 h-14 rounded-lg bg-surface-container flex items-center justify-center text-label-sm text-on-surface-variant">+{review.photos.length - 3}</span>}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-row lg:flex-col gap-xs items-start">
        <button type="button" onClick={() => onAction("pin", review.id)}
          className={`inline-flex items-center gap-1 px-sm py-[5px] rounded-lg text-label-sm font-semibold transition-opacity ${review.isPinned ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"}`}
          title={review.isPinned ? "Unpin review" : "Pin review"}>
          <Icon name="push_pin" size={14} />
          {review.isPinned ? "Unpin" : "Pin"}
        </button>

        <button type="button" onClick={() => onReply(review.id, review.merchantReply || "")}
          className="inline-flex items-center gap-1 px-sm py-[5px] rounded-lg bg-secondary-container text-on-secondary-container text-label-sm font-semibold hover:opacity-80 transition-opacity">
          <Icon name="reply" size={14} />
          {review.merchantReply ? "Edit Reply" : "Reply"}
        </button>

        {status.key !== "approved" && (
          <button type="button" onClick={() => onAction("approve", review.id)}
            className="inline-flex items-center gap-1 px-sm py-[5px] rounded-lg bg-secondary-container text-on-secondary-container text-label-sm font-semibold hover:opacity-80 transition-opacity">
            <Icon name="check_circle" size={14} /> Approve
          </button>
        )}
        {status.key !== "rejected" && (
          <button type="button" onClick={() => onAction("reject", review.id)}
            className="inline-flex items-center gap-1 px-sm py-[5px] rounded-lg border border-outline-variant text-on-surface-variant text-label-sm font-semibold hover:bg-surface-container transition-colors">
            <Icon name="block" size={14} /> Reject
          </button>
        )}
        <button type="button" onClick={() => { if (confirm("Delete this review? This cannot be undone.")) onAction("delete", review.id); }}
          className="inline-flex items-center gap-1 px-sm py-[5px] rounded-lg border border-error-container text-error text-label-sm font-semibold hover:bg-error-container transition-colors">
          <Icon name="delete" size={14} /> Delete
        </button>
      </div>
    </div>
  );
}

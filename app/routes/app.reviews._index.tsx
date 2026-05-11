import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { deleteFolder } from "~/r2.server";
import { analyzeReviewSentiment } from "~/ai.server";
import { isFeatureAvailable } from "~/utils/plan-limits.server";

const PAGE_SIZE = 20;

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const skip = (page - 1) * PAGE_SIZE;

  const [reviews, totalCount] = await Promise.all([
    db.review.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      skip,
      take: PAGE_SIZE,
      include: {
        customer: {
          select: { email: true, firstName: true, lastName: true },
        },
      },
    }),
    db.review.count({ where: { shopId: shop.id } }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return json({
    reviews,
    totalCount,
    page,
    totalPages,
    plan: shop.plan,
    canAnalyzeSentiment: isFeatureAvailable(shop.plan, "review_sentiment"),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const reviewId = formData.get("reviewId") as string;

  if (!reviewId) {
    return json({ error: "Review ID is required" }, { status: 400 });
  }

  const review = await db.review.findFirst({
    where: { id: reviewId, shopId: shop.id },
  });

  if (!review) {
    return json({ error: "Review not found" }, { status: 404 });
  }

  switch (intent) {
    case "approve": {
      await db.review.update({
        where: { id: reviewId },
        data: { isApproved: true, isPublished: true },
      });

      // Task 21.2: Award loyalty points for approved review (Req 8.3)
      if (review.customerId) {
        try {
          const loyaltyProgram = await db.loyaltyProgram.findUnique({
            where: { shopId: shop.id },
          });

          if (loyaltyProgram && loyaltyProgram.isActive && loyaltyProgram.pointsForReview > 0) {
            await db.$transaction([
              db.loyaltyTransaction.create({
                data: {
                  shopId: shop.id,
                  customerId: review.customerId,
                  programId: loyaltyProgram.id,
                  type: 'earn',
                  points: loyaltyProgram.pointsForReview,
                  reason: 'Review approved',
                },
              }),
              db.customer.update({
                where: { id: review.customerId },
                data: {
                  loyaltyPoints: { increment: loyaltyProgram.pointsForReview },
                },
              }),
            ]);
          }
        } catch (error) {
          // Non-blocking — don't fail the approval for loyalty points
          console.error('[reviews] Failed to award loyalty points for review:', error);
        }
      }

      return json({ success: true, message: "Review approved and published." });
    }

    case "reject": {
      await db.review.update({
        where: { id: reviewId },
        data: { isApproved: false, isPublished: false },
      });
      return json({ success: true, message: "Review rejected." });
    }

    case "delete": {
      // Delete associated R2 photos
      try {
        await deleteFolder(`reviews/${shop.id}/${reviewId}`);
      } catch {
        // Log but don't block deletion — R2 cleanup is non-blocking
      }

      await db.review.delete({ where: { id: reviewId } });
      return json({ success: true, message: "Review deleted." });
    }

    case "analyze": {
      if (!isFeatureAvailable(shop.plan, "review_sentiment")) {
        return json(
          { error: "Sentiment analysis requires the Growth or Pro plan." },
          { status: 403 }
        );
      }

      if (!review.body) {
        return json(
          { error: "Review has no body text to analyze." },
          { status: 400 }
        );
      }

      try {
        const sentiment = await analyzeReviewSentiment(review.body);
        await db.review.update({
          where: { id: reviewId },
          data: { sentiment },
        });
        return json({
          success: true,
          message: `Sentiment analyzed: ${sentiment}`,
        });
      } catch {
        return json(
          { error: "Failed to analyze sentiment. Please try again." },
          { status: 500 }
        );
      }
    }

    default:
      return json({ error: "Invalid action" }, { status: 400 });
  }
}

export default function ReviewsModerationDashboard() {
  const { reviews, totalCount, page, totalPages, canAnalyzeSentiment } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  const handleAction = (intent: string, reviewId: string) => {
    const formData = new FormData();
    formData.set("intent", intent);
    formData.set("reviewId", reviewId);
    submit(formData, { method: "post" });
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1
          style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "4px" }}
        >
          Review Moderation
        </h1>
        <p style={{ color: "#6b7280" }}>
          {totalCount} review{totalCount !== 1 ? "s" : ""} total
        </p>
      </div>

      {actionData && "message" in actionData && actionData.message && (
        <div
          role="alert"
          style={{
            padding: "12px 16px",
            marginBottom: "16px",
            backgroundColor: "#d1fae5",
            border: "1px solid #6ee7b7",
            borderRadius: "8px",
            color: "#065f46",
          }}
        >
          {actionData.message}
        </div>
      )}

      {actionData && "error" in actionData && actionData.error && (
        <div
          role="alert"
          style={{
            padding: "12px 16px",
            marginBottom: "16px",
            backgroundColor: "#fee2e2",
            border: "1px solid #fca5a5",
            borderRadius: "8px",
            color: "#991b1b",
          }}
        >
          {actionData.error}
        </div>
      )}

      {reviews.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "48px",
            color: "#6b7280",
            backgroundColor: "#f9fafb",
            borderRadius: "8px",
          }}
        >
          <p style={{ fontSize: "16px" }}>No reviews yet.</p>
          <p style={{ fontSize: "14px" }}>
            Reviews will appear here once customers submit them.
          </p>
        </div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            {reviews.map((review) => (
              <ReviewCard
                key={review.id}
                review={review}
                canAnalyzeSentiment={canAnalyzeSentiment}
                onAction={handleAction}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: "8px",
                marginTop: "24px",
              }}
            >
              {page > 1 && (
                <a
                  href={`?page=${page - 1}`}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                    textDecoration: "none",
                    color: "#374151",
                  }}
                >
                  Previous
                </a>
              )}
              <span
                style={{
                  padding: "8px 16px",
                  color: "#6b7280",
                }}
              >
                Page {page} of {totalPages}
              </span>
              {page < totalPages && (
                <a
                  href={`?page=${page + 1}`}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                    textDecoration: "none",
                    color: "#374151",
                  }}
                >
                  Next
                </a>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReviewCard({
  review,
  canAnalyzeSentiment,
  onAction,
}: {
  review: {
    id: string;
    rating: number;
    title: string | null;
    body: string | null;
    productTitle: string;
    isApproved: boolean;
    isPublished: boolean;
    sentiment: string | null;
    helpfulCount: number;
    verifiedPurchase: boolean;
    photos: string[];
    createdAt: string;
    customer: {
      email: string;
      firstName: string | null;
      lastName: string | null;
    } | null;
  };
  canAnalyzeSentiment: boolean;
  onAction: (intent: string, reviewId: string) => void;
}) {
  const statusColor = review.isPublished
    ? "#059669"
    : review.isApproved
      ? "#d97706"
      : "#6b7280";
  const statusLabel = review.isPublished
    ? "Published"
    : review.isApproved
      ? "Approved"
      : "Pending";

  const sentimentColor =
    review.sentiment === "positive"
      ? "#059669"
      : review.sentiment === "negative"
        ? "#dc2626"
        : "#d97706";

  const customerName = review.customer
    ? [review.customer.firstName, review.customer.lastName]
        .filter(Boolean)
        .join(" ") || review.customer.email
    : "Anonymous";

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "16px",
        backgroundColor: "#ffffff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "12px",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "4px",
            }}
          >
            <span style={{ fontSize: "16px" }}>
              {"★".repeat(review.rating)}
              {"☆".repeat(5 - review.rating)}
            </span>
            <span
              style={{
                fontSize: "12px",
                padding: "2px 8px",
                borderRadius: "12px",
                backgroundColor: `${statusColor}20`,
                color: statusColor,
                fontWeight: "600",
              }}
            >
              {statusLabel}
            </span>
            {review.verifiedPurchase && (
              <span
                style={{
                  fontSize: "12px",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  backgroundColor: "#dbeafe",
                  color: "#1d4ed8",
                  fontWeight: "600",
                }}
              >
                Verified
              </span>
            )}
            {review.sentiment && (
              <span
                style={{
                  fontSize: "12px",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  backgroundColor: `${sentimentColor}20`,
                  color: sentimentColor,
                  fontWeight: "600",
                }}
              >
                {review.sentiment}
              </span>
            )}
          </div>
          <p style={{ fontSize: "14px", color: "#374151", fontWeight: "600" }}>
            {review.title || "No title"}
          </p>
          <p style={{ fontSize: "12px", color: "#6b7280" }}>
            by {customerName} • {review.productTitle} •{" "}
            {new Date(review.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div style={{ fontSize: "12px", color: "#6b7280" }}>
          👍 {review.helpfulCount}
        </div>
      </div>

      {review.body && (
        <p
          style={{
            fontSize: "14px",
            color: "#4b5563",
            marginBottom: "12px",
            lineHeight: "1.5",
          }}
        >
          {review.body}
        </p>
      )}

      {review.photos.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: "8px",
            marginBottom: "12px",
            flexWrap: "wrap",
          }}
        >
          {review.photos.map((photo, idx) => (
            <img
              key={idx}
              src={photo}
              alt={`Review photo ${idx + 1}`}
              style={{
                width: "64px",
                height: "64px",
                objectFit: "cover",
                borderRadius: "4px",
                border: "1px solid #e5e7eb",
              }}
            />
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {!review.isPublished && (
          <button
            type="button"
            onClick={() => onAction("approve", review.id)}
            style={{
              padding: "6px 12px",
              fontSize: "13px",
              borderRadius: "6px",
              border: "none",
              backgroundColor: "#059669",
              color: "#ffffff",
              cursor: "pointer",
              fontWeight: "500",
            }}
            aria-label={`Approve review by ${customerName}`}
          >
            Approve
          </button>
        )}
        {review.isPublished && (
          <button
            type="button"
            onClick={() => onAction("reject", review.id)}
            style={{
              padding: "6px 12px",
              fontSize: "13px",
              borderRadius: "6px",
              border: "1px solid #d97706",
              backgroundColor: "transparent",
              color: "#d97706",
              cursor: "pointer",
              fontWeight: "500",
            }}
            aria-label={`Reject review by ${customerName}`}
          >
            Unpublish
          </button>
        )}
        {canAnalyzeSentiment && !review.sentiment && review.body && (
          <button
            type="button"
            onClick={() => onAction("analyze", review.id)}
            style={{
              padding: "6px 12px",
              fontSize: "13px",
              borderRadius: "6px",
              border: "1px solid #6366f1",
              backgroundColor: "transparent",
              color: "#6366f1",
              cursor: "pointer",
              fontWeight: "500",
            }}
            aria-label={`Analyze sentiment for review by ${customerName}`}
          >
            Analyze Sentiment
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (confirm("Are you sure you want to delete this review?")) {
              onAction("delete", review.id);
            }
          }}
          style={{
            padding: "6px 12px",
            fontSize: "13px",
            borderRadius: "6px",
            border: "1px solid #dc2626",
            backgroundColor: "transparent",
            color: "#dc2626",
            cursor: "pointer",
            fontWeight: "500",
          }}
          aria-label={`Delete review by ${customerName}`}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

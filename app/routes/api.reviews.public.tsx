import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/db.server";

/**
 * Public API endpoint for fetching published reviews for a product.
 * Used by the review-widget Theme App Extension on the storefront.
 *
 * GET /api/reviews/public?shopId={shopId}&productId={productId}&page={page}&limit={limit}
 *
 * Returns JSON: { reviews: [...], averageRating, totalCount, page, totalPages }
 * Only returns reviews where isPublished = true.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shopId = url.searchParams.get("shopId");
  const productId = url.searchParams.get("productId");
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(
    50,
    Math.max(1, parseInt(url.searchParams.get("limit") || "10", 10)),
  );

  if (!shopId || !productId) {
    return json(
      { error: "shopId and productId are required" },
      { status: 400 },
    );
  }

  // Verify the shop exists and is active
  const shop = await db.shop.findUnique({
    where: { id: shopId },
    select: { id: true, isActive: true },
  });

  if (!shop || !shop.isActive) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  // Get total count of published reviews for this product
  const totalCount = await db.review.count({
    where: {
      shopId,
      shopifyProductId: productId,
      isPublished: true,
    },
  });

  // Calculate aggregate rating
  const aggregation = await db.review.aggregate({
    where: {
      shopId,
      shopifyProductId: productId,
      isPublished: true,
    },
    _avg: { rating: true },
  });

  const averageRating = aggregation._avg.rating
    ? Math.round(aggregation._avg.rating * 10) / 10
    : 0;

  // Fetch paginated reviews
  const skip = (page - 1) * limit;
  const reviews = await db.review.findMany({
    where: {
      shopId,
      shopifyProductId: productId,
      isPublished: true,
    },
    select: {
      id: true,
      rating: true,
      title: true,
      body: true,
      photos: true,
      verifiedPurchase: true,
      helpfulCount: true,
      merchantReply: true,
      repliedAt: true,
      createdAt: true,
      customer: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
    },
    orderBy: [{ isPinned: "desc" as const }, { createdAt: "desc" as const }],
    skip,
    take: limit,
  });

  // Format reviews for the storefront
  const formattedReviews = reviews.map((review) => ({
    id: review.id,
    rating: review.rating,
    title: review.title,
    body: review.body,
    photos: review.photos,
    verifiedPurchase: review.verifiedPurchase,
    helpfulCount: review.helpfulCount,
    createdAt: review.createdAt.toISOString(),
    reviewerName: formatReviewerName(
      review.customer?.firstName,
      review.customer?.lastName,
    ),
    merchantReply: review.merchantReply,
  }));

  const totalPages = Math.ceil(totalCount / limit);

  return json(
    {
      reviews: formattedReviews,
      averageRating,
      totalCount,
      page,
      totalPages,
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "public, max-age=60",
      },
    },
  );
}

function formatReviewerName(
  firstName?: string | null,
  lastName?: string | null,
): string {
  if (firstName && lastName) {
    return `${firstName} ${lastName.charAt(0)}.`;
  }
  if (firstName) {
    return firstName;
  }
  return "Anonymous";
}

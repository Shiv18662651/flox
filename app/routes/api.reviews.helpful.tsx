import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/db.server";

/**
 * Public endpoint to increment the helpful count on a review.
 * POST /api/reviews/helpful
 * Body: { reviewId: string }
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  let reviewId: string;

  try {
    const body = await request.json();
    reviewId = body.reviewId;
  } catch {
    return json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!reviewId || typeof reviewId !== "string") {
    return json({ error: "reviewId is required" }, { status: 400 });
  }

  const review = await db.review.findUnique({
    where: { id: reviewId },
    select: { id: true, isPublished: true },
  });

  if (!review) {
    return json({ error: "Review not found" }, { status: 404 });
  }

  if (!review.isPublished) {
    return json({ error: "Review is not published" }, { status: 403 });
  }

  const updated = await db.review.update({
    where: { id: reviewId },
    data: { helpfulCount: { increment: 1 } },
    select: { helpfulCount: true },
  });

  return json({ helpfulCount: updated.helpfulCount });
}

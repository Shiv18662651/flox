import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/db.server";
import { buildR2Key, uploadFile, validateFileUpload } from "~/r2.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return json({ error: "Missing review token" }, { status: 400 });
  }

  // Validate token against a valid, unprocessed ReviewRequest
  const reviewRequest = await db.reviewRequest.findUnique({
    where: { token },
  });

  if (!reviewRequest) {
    return json({ error: "Invalid review token" }, { status: 403 });
  }

  if (reviewRequest.status === "reviewed") {
    return json(
      { error: "This review has already been submitted" },
      { status: 400 },
    );
  }

  // Parse multipart form data
  const formData = await request.formData();
  const ratingRaw = formData.get("rating");
  const rating = parseInt(ratingRaw as string, 10);
  const title = (formData.get("title") as string) || null;
  const body = (formData.get("body") as string) || null;
  const shopifyProductId = (formData.get("productId") as string) || "";

  // Validate rating (1–5)
  if (!ratingRaw || isNaN(rating) || rating < 1 || rating > 5) {
    return json(
      { error: "Rating must be between 1 and 5" },
      { status: 400 },
    );
  }

  // Handle photo uploads (up to 5)
  const photoFiles = formData.getAll("photos") as File[];
  if (photoFiles.length > 5) {
    return json({ error: "Maximum 5 photos allowed" }, { status: 400 });
  }

  const photoUrls: string[] = [];
  const uploadErrors: string[] = [];

  // Create the review first to get the ID for R2 key path
  const review = await db.review.create({
    data: {
      shopId: reviewRequest.shopId,
      shopifyProductId: shopifyProductId || "unknown",
      productTitle: "",
      rating,
      title,
      body,
      photos: [],
      videos: [],
      verifiedPurchase: true,
      isApproved: false,
      isPublished: false,
      orderId: reviewRequest.orderId,
    },
  });

  // Upload photos to R2 under reviews/{shopId}/{reviewId}/{filename}
  for (const file of photoFiles) {
    if (!(file instanceof File) || file.size === 0) continue;

    const validation = validateFileUpload(file.size, file.type);
    if (!validation.valid) {
      uploadErrors.push(`${file.name}: ${validation.error}`);
      continue;
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const key = buildR2Key(
        "reviews",
        reviewRequest.shopId,
        review.id,
        file.name,
      );
      const cdnUrl = await uploadFile(key, buffer, file.type);
      photoUrls.push(cdnUrl);
    } catch (err) {
      uploadErrors.push(`${file.name}: Upload failed`);
    }
  }

  // Update review with uploaded photo URLs
  if (photoUrls.length > 0) {
    await db.review.update({
      where: { id: review.id },
      data: { photos: photoUrls },
    });
  }

  // Mark ReviewRequest as reviewed
  await db.reviewRequest.update({
    where: { id: reviewRequest.id },
    data: { status: "reviewed" },
  });

  const response: Record<string, unknown> = {
    success: true,
    reviewId: review.id,
    message: "Thank you for your review! It will be visible after approval.",
  };

  if (uploadErrors.length > 0) {
    response.photoErrors = uploadErrors;
    response.message =
      "Review submitted, but some photos could not be uploaded.";
  }

  return json(response, { status: 201 });
}

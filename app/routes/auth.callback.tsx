import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import shopify, { authenticate } from "~/shopify.server";
import { db } from "~/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  // Handle OAuth errors (Requirement 1.7)
  const error = url.searchParams.get("error");
  if (error) {
    const errorDescription =
      url.searchParams.get("error_description") ||
      "An error occurred during authentication";
    throw new Response(
      `<html><body>
        <h1>Authentication Error</h1>
        <p>${errorDescription}</p>
        <a href="/">Retry Installation</a>
      </body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  // Exchange authorization code for access token (Requirement 1.1, 1.2)
  const { session } = await authenticate.admin(request);

  // Check if this is a first-time install (Requirement 1.3)
  const existingShop = await db.shop.findUnique({
    where: { shopDomain: session.shop },
  });

  if (!existingShop) {
    // First-time install: create Shop with STARTER plan (Requirement 1.3)
    const shop = await db.shop.create({
      data: {
        shopDomain: session.shop,
        accessToken: session.accessToken || "",
        plan: "STARTER",
        isActive: true,
      },
    });

    // Initialize default settings for all modules (Requirement 1.5)
    await Promise.all([
      db.seoSettings.create({
        data: {
          shopId: shop.id,
          autoMetaTags: true,
          autoAltText: true,
          autoSchema: true,
        },
      }),
      db.loyaltyProgram.create({
        data: {
          shopId: shop.id,
          isActive: false,
          pointsPerDollar: 1,
          pointsForSignup: 100,
          pointsForReview: 50,
          pointsForReferral: 200,
          rewardValue: 0.01,
        },
      }),
      db.referralProgram.create({
        data: {
          shopId: shop.id,
          isActive: false,
          advocateReward: 10,
          friendDiscount: 15,
          rewardType: "discount",
        },
      }),
    ]);
  } else if (!existingShop.isActive) {
    // Reinstall: reactivate the shop and update access token
    await db.shop.update({
      where: { id: existingShop.id },
      data: {
        isActive: true,
        accessToken: session.accessToken || existingShop.accessToken,
      },
    });
  }

  // Redirect to the app dashboard
  return redirect("/app");
}

// Email tracking endpoint - open pixel and click redirect
// Requirements: 7.5, 7.6

import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "~/db.server";

// 1x1 transparent GIF pixel
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id");

  if (!type || !id) {
    return new Response("Missing parameters", { status: 400 });
  }

  if (type === "open") {
    // Track email open - update EmailSend and Campaign
    try {
      const emailSend = await db.emailSend.findUnique({
        where: { id },
        select: { id: true, openedAt: true, campaignId: true },
      });

      if (emailSend && !emailSend.openedAt) {
        await db.emailSend.update({
          where: { id },
          data: { openedAt: new Date() },
        });

        // Increment campaign open count
        if (emailSend.campaignId) {
          await db.campaign.update({
            where: { id: emailSend.campaignId },
            data: { openCount: { increment: 1 } },
          });
        }
      }
    } catch (error) {
      // Silently fail - don't break the pixel response
      console.error("[tracking] Open tracking error:", error);
    }

    // Return 1x1 transparent GIF
    return new Response(TRANSPARENT_GIF, {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  }

  if (type === "click") {
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return new Response("Missing URL parameter", { status: 400 });
    }

    // Track email click - update EmailSend and Campaign
    try {
      const emailSend = await db.emailSend.findUnique({
        where: { id },
        select: { id: true, clickedAt: true, campaignId: true },
      });

      if (emailSend && !emailSend.clickedAt) {
        await db.emailSend.update({
          where: { id },
          data: { clickedAt: new Date() },
        });

        // Increment campaign click count
        if (emailSend.campaignId) {
          await db.campaign.update({
            where: { id: emailSend.campaignId },
            data: { clickCount: { increment: 1 } },
          });
        }
      }
    } catch (error) {
      console.error("[tracking] Click tracking error:", error);
    }

    // Redirect to the original URL
    return new Response(null, {
      status: 302,
      headers: {
        Location: decodeURIComponent(targetUrl),
      },
    });
  }

  return new Response("Invalid tracking type", { status: 400 });
}

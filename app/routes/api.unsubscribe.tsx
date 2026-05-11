// Unsubscribe endpoint - handles email unsubscribe links
// Requirements: 7.11

import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "~/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("id");

  if (!customerId) {
    return new Response(renderUnsubscribePage("Invalid unsubscribe link."), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  try {
    const customer = await db.customer.findUnique({
      where: { id: customerId },
      select: { id: true, email: true, isSubscribed: true },
    });

    if (!customer) {
      return new Response(renderUnsubscribePage("Invalid unsubscribe link."), {
        status: 404,
        headers: { "Content-Type": "text/html" },
      });
    }

    if (!customer.isSubscribed) {
      return new Response(
        renderUnsubscribePage("You are already unsubscribed."),
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }

    // Set isSubscribed = false
    await db.customer.update({
      where: { id: customerId },
      data: { isSubscribed: false },
    });

    return new Response(
      renderUnsubscribePage("You have been successfully unsubscribed. You will no longer receive marketing emails from us."),
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  } catch (error) {
    console.error("[unsubscribe] Error:", error);
    return new Response(
      renderUnsubscribePage("An error occurred. Please try again later."),
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }
}

function renderUnsubscribePage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Unsubscribe</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background-color: #f3f4f6;
    }
    .card {
      background: white;
      padding: 48px;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      text-align: center;
      max-width: 400px;
    }
    h1 { font-size: 24px; margin-bottom: 16px; color: #111827; }
    p { color: #6b7280; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Email Preferences</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

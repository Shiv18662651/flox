// Brevo webhook handler - processes bounce and spam complaint events
// Requirements: 7.12

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/db.server";

interface BrevoWebhookEvent {
  event: string; // "hard_bounce" | "soft_bounce" | "spam" | "complaint"
  email: string;
  "message-id"?: string;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let payload: BrevoWebhookEvent;
  try {
    payload = await request.json() as BrevoWebhookEvent;
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { event, email } = payload;

  // Handle bounce and spam complaint events
  if (event === "hard_bounce" || event === "spam" || event === "complaint") {
    if (!email) {
      return json({ error: "Missing email" }, { status: 400 });
    }

    // Find all customers with this email and unsubscribe them
    try {
      await db.customer.updateMany({
        where: { email: email.toLowerCase() },
        data: { isSubscribed: false },
      });

      console.log(`[brevo-webhook] Unsubscribed ${email} due to ${event}`)
    } catch (error) {
      console.error(`[brevo-webhook] Error unsubscribing ${email}:`, error);
    }
  }

  return json({ received: true });
}

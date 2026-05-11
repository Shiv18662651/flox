// Pre-built email templates merchants can clone as starting points.
// Each template is a valid EmailBlock[] payload that renders via renderEmailHtml().
// Templates are copied into new Campaigns/Automations on import so merchants
// can edit them freely without affecting other shops.

import type { EmailBlock } from "~/utils/email-renderer.server";

export interface PrebuiltTemplate {
  /** Stable identifier (used as URL slug and lookup key) */
  id: "welcome" | "abandoned-cart" | "post-purchase";
  /** Short human-readable name */
  name: string;
  /** Suggested email subject line */
  subject: string;
  /** One-line description shown in the template picker */
  description: string;
  /** Matching automation trigger, if this template is intended for a flow */
  trigger?: "welcome" | "abandoned_cart" | "post_purchase";
  /** Recommended delay in minutes (for automations) */
  delayMinutes?: number;
  /** The block-based template body */
  blocks: EmailBlock[];
}

/**
 * Welcome email — sent to new customers on signup.
 * Warm greeting + optional discount incentive + CTA to browse.
 */
export const WELCOME_TEMPLATE: PrebuiltTemplate = {
  id: "welcome",
  name: "Welcome Email",
  subject: "Welcome! Here's a little something to get you started 🎉",
  description:
    "First touchpoint for new customers. Warm greeting with an intro CTA.",
  trigger: "welcome",
  delayMinutes: 0,
  blocks: [
    {
      type: "text",
      content:
        "Hey there, and welcome! We're thrilled to have you join the community.",
    },
    {
      type: "text",
      content:
        "Browse our latest collection and find something you'll love. As a thank-you for signing up, shipping is on us on your first order.",
    },
    { type: "divider" },
    {
      type: "button",
      text: "Start Shopping",
      url: "https://{{shop_url}}/collections/all",
    },
    { type: "divider" },
    {
      type: "text",
      content:
        "Questions? Just reply to this email — a real human will get back to you.",
    },
  ],
};

/**
 * Abandoned cart email — sent ~60 minutes after a customer abandons checkout.
 * Reminder + low-friction CTA back to checkout.
 */
export const ABANDONED_CART_TEMPLATE: PrebuiltTemplate = {
  id: "abandoned-cart",
  name: "Abandoned Cart Recovery",
  subject: "You left something behind...",
  description:
    "Nudges customers back to their cart with a friendly reminder.",
  trigger: "abandoned_cart",
  delayMinutes: 60,
  blocks: [
    {
      type: "text",
      content:
        "Hi! We noticed you left a few items in your cart. No pressure — just wanted to make sure you didn't miss out.",
    },
    { type: "divider" },
    {
      type: "text",
      content:
        "Your cart is saved and ready whenever you are. Complete your order in one click:",
    },
    {
      type: "button",
      text: "Return to Checkout",
      url: "{{checkout_url}}",
    },
    { type: "divider" },
    {
      type: "text",
      content:
        "Items tend to sell out quickly. Grab them while they're still in stock!",
    },
  ],
};

/**
 * Post-purchase email — sent shortly after an order is placed.
 * Thank you + order confirmation + cross-sell hint.
 */
export const POST_PURCHASE_TEMPLATE: PrebuiltTemplate = {
  id: "post-purchase",
  name: "Post-Purchase Thank You",
  subject: "Thank you for your order! 🙏",
  description:
    "Confirms the order, shares shipping expectations, and suggests related products.",
  trigger: "post_purchase",
  delayMinutes: 30,
  blocks: [
    {
      type: "text",
      content:
        "Thank you so much for your order! We're getting it ready and you'll get a shipping notification as soon as it's on the way.",
    },
    { type: "divider" },
    {
      type: "text",
      content: "Order total: {{order_total}}",
    },
    {
      type: "text",
      content: "Estimated delivery: 3–5 business days.",
    },
    { type: "divider" },
    {
      type: "text",
      content: "Loved your order? Check out these related picks:",
    },
    {
      type: "button",
      text: "See Related Products",
      url: "https://{{shop_url}}/collections/recommended",
    },
    { type: "divider" },
    {
      type: "text",
      content:
        "Once you've had a chance to try your order, we'd love your honest review.",
    },
  ],
};

/**
 * Full catalog of pre-built templates, keyed by id.
 */
export const PREBUILT_TEMPLATES: Record<
  PrebuiltTemplate["id"],
  PrebuiltTemplate
> = {
  welcome: WELCOME_TEMPLATE,
  "abandoned-cart": ABANDONED_CART_TEMPLATE,
  "post-purchase": POST_PURCHASE_TEMPLATE,
};

/**
 * Ordered list of templates for rendering in pickers/catalogs.
 */
export const PREBUILT_TEMPLATE_LIST: PrebuiltTemplate[] = [
  WELCOME_TEMPLATE,
  ABANDONED_CART_TEMPLATE,
  POST_PURCHASE_TEMPLATE,
];

/**
 * Safely retrieve a pre-built template by id. Returns null on unknown ids.
 */
export function getPrebuiltTemplate(
  id: string
): PrebuiltTemplate | null {
  return (
    (PREBUILT_TEMPLATES as Record<string, PrebuiltTemplate>)[id] ?? null
  );
}

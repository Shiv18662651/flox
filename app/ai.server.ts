import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

/**
 * Generate SEO-optimized meta title and description for a product.
 */
export async function generateSeoMeta(product: {
  title: string;
  description?: string;
  vendor?: string;
}): Promise<{ metaTitle: string; metaDescription: string }> {
  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          'You are an SEO expert. Generate an optimized meta title (max 60 chars) and meta description (max 160 chars) for the given product. Return JSON: {"metaTitle": "...", "metaDescription": "..."}',
      },
      {
        role: "user",
        content: `Product: ${product.title}${product.description ? `. Description: ${product.description}` : ""}${product.vendor ? `. Brand: ${product.vendor}` : ""}`,
      },
    ],
    max_tokens: 150,
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content || "{}";
  try {
    return JSON.parse(content);
  } catch {
    return {
      metaTitle: product.title.slice(0, 60),
      metaDescription: product.description?.slice(0, 160) || product.title,
    };
  }
}

/**
 * Generate an AI summary of product reviews.
 * Returns key themes, pros, cons, and overall sentiment.
 */
export async function generateReviewSummary(reviews: Array<{
  rating: number;
  title: string | null;
  body: string | null;
  verifiedPurchase: boolean;
}>): Promise<{
  summary: string;
  pros: string[];
  cons: string[];
  sentiment: "positive" | "neutral" | "negative";
}> {
  const reviewTexts = reviews
    .map((r) => `[${r.rating}/5] ${r.title || ""} ${r.body || ""}`.trim())
    .join("\n---\n");

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a product review analyst. Summarize the provided customer reviews into a concise overall summary (2-3 sentences), a list of top 3 pros, a list of top 3 cons (if any), and an overall sentiment. Return ONLY valid JSON with this exact structure: {\"summary\":\"...\",\"pros\":[\"...\"],\"cons\":[\"...\"],\"sentiment\":\"positive|neutral|negative\"}. If there are no cons, return an empty array.",
      },
      { role: "user", content: `Reviews:\n${reviewTexts}` },
    ],
    max_tokens: 400,
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content || "{}";
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    return {
      summary: parsed.summary || "No summary available.",
      pros: Array.isArray(parsed.pros) ? parsed.pros : [],
      cons: Array.isArray(parsed.cons) ? parsed.cons : [],
      sentiment: ["positive", "neutral", "negative"].includes(parsed.sentiment) ? parsed.sentiment : "neutral",
    };
  } catch {
    return { summary: "Unable to generate summary.", pros: [], cons: [], sentiment: "neutral" };
  }
}

/**
 * Generate descriptive alt text for a product image (accessibility).
 */
export async function generateAltText(
  imageUrl: string,
  productTitle: string
): Promise<string> {
  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "Generate a concise, descriptive alt text (max 125 chars) for a product image. Be specific and descriptive for accessibility.",
      },
      {
        role: "user",
        content: `Product: ${productTitle}. Image URL: ${imageUrl}`,
      },
    ],
    max_tokens: 50,
    temperature: 0.3,
  });

  return (
    response.choices[0]?.message?.content || `Image of ${productTitle}`
  );
}

/**
 * Analyze the sentiment of a product review text.
 * Returns 'positive', 'neutral', or 'negative'.
 */
export async function analyzeReviewSentiment(
  reviewText: string
): Promise<"positive" | "neutral" | "negative"> {
  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "Classify the sentiment of the following product review as exactly one word: positive, neutral, or negative. Reply with only that one word.",
      },
      { role: "user", content: reviewText },
    ],
    max_tokens: 10,
    temperature: 0,
  });

  const result = response.choices[0]?.message?.content?.trim().toLowerCase();
  if (
    result === "positive" ||
    result === "neutral" ||
    result === "negative"
  ) {
    return result;
  }
  return "neutral";
}

interface AIGeneratedFlow {
  name: string;
  trigger: string;
  delayMinutes: number;
  subject: string;
  blocks: Array<{
    type: string;
    content?: string;
    src?: string;
    alt?: string;
    url?: string;
    text?: string;
    align?: string;
    products?: Array<{ id: string; title: string; image: string; price: string; url: string }>;
  }>;
}

/**
 * Generate an email automation flow from a natural language description.
 */
export async function generateFlowFromDescription(
  description: string
): Promise<AIGeneratedFlow> {
  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: `You are an email marketing automation expert. Given a user's description, generate a complete email automation flow. Return ONLY valid JSON with this exact structure:
{
  "name": "Flow name",
  "trigger": "one of: abandoned_cart, welcome, post_purchase, win_back, birthday",
  "delayMinutes": number (60 for 1 hour, 1440 for 1 day, 10080 for 1 week),
  "subject": "Email subject line",
  "blocks": [
    { "type": "heading", "content": "Headline text" },
    { "type": "text", "content": "Body paragraph text" },
    { "type": "button", "text": "Button text", "url": "https://example.com" },
    { "type": "divider" }
  ]
}
Choose the most appropriate trigger based on the description. Keep content concise and conversion-focused.`,
      },
      { role: "user", content: description },
    ],
    max_tokens: 800,
    temperature: 0.5,
  });

  const content = response.choices[0]?.message?.content || "{}";
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    return {
      name: parsed.name || "Generated Flow",
      trigger: ["abandoned_cart", "welcome", "post_purchase", "win_back", "birthday"].includes(parsed.trigger)
        ? parsed.trigger
        : "welcome",
      delayMinutes: typeof parsed.delayMinutes === "number" ? parsed.delayMinutes : 60,
      subject: parsed.subject || "Welcome!",
      blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [
        { type: "heading", content: "Welcome!" },
        { type: "text", content: "Thanks for joining us." },
      ],
    };
  } catch {
    return {
      name: "Welcome Flow",
      trigger: "welcome",
      delayMinutes: 60,
      subject: "Welcome to our store!",
      blocks: [
        { type: "heading", content: "Welcome!" },
        { type: "text", content: "Thanks for joining us. We're excited to have you on board." },
        { type: "button", text: "Shop Now", url: "https://example.com" },
      ],
    };
  }
}

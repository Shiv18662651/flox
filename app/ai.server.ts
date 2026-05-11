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

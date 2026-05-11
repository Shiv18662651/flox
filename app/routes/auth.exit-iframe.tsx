import type { LoaderFunctionArgs } from "@remix-run/node";

/**
 * Exit-iframe route for Shopify embedded OAuth.
 * Renders a minimal page that breaks out of the iframe and redirects
 * the top-level window to the OAuth start URL.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const exitIframe = url.searchParams.get("exitIframe") || "/auth";
  const host = url.searchParams.get("host") || "";

  const appUrl = process.env.SHOPIFY_APP_URL || "https://thenexify.app";
  const targetUrl = exitIframe.startsWith("http")
    ? exitIframe
    : `${appUrl}${exitIframe}`;

  // Simple top-level redirect — no App Bridge needed
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Redirecting...</title>
</head>
<body>
  <script>
    if (window.top !== window.self) {
      window.top.location.href = "${targetUrl}";
    } else {
      window.location.href = "${targetUrl}";
    }
  </script>
  <p>Redirecting...</p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html",
      "Content-Security-Policy": "frame-ancestors https://*.myshopify.com https://admin.shopify.com;",
    },
  });
}

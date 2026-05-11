import type { LoaderFunctionArgs } from "@remix-run/node";

/**
 * This route is used by Shopify's App Bridge to exit the iframe during OAuth.
 * When the app is embedded, Shopify redirects here with exitIframe param
 * containing the target URL. This page renders a script that uses App Bridge
 * to navigate the top-level window to the auth URL.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const exitIframe = url.searchParams.get("exitIframe") || "/auth";
  const host = url.searchParams.get("host") || "";
  const shop = url.searchParams.get("shop") || "";

  // Build the full redirect URL
  const appUrl = process.env.SHOPIFY_APP_URL || "https://thenexify.app";
  const redirectUrl = exitIframe.startsWith("http")
    ? exitIframe
    : `${appUrl}${exitIframe}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Redirecting...</title>
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  <script>
    const host = "${host}";
    const redirectUri = "${redirectUrl}";
    const shop = "${shop}";

    if (window.top === window.self) {
      // Not in iframe, redirect directly
      window.location.href = redirectUri;
    } else {
      // In iframe, use App Bridge to redirect parent
      const AppBridge = window['app-bridge'];
      const createApp = AppBridge.default;
      const app = createApp({
        apiKey: "${process.env.SHOPIFY_API_KEY}",
        host: host,
      });
      const { Redirect } = AppBridge.actions;
      const redirect = Redirect.create(app);
      redirect.dispatch(Redirect.Action.REMOTE, redirectUri);
    }
  </script>
</head>
<body>
  <p>Redirecting...</p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

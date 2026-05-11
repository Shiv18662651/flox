import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";

export const meta: MetaFunction = () => {
  return [
    { title: "Nexify - Shopify Super-App" },
    { name: "description", content: "All-in-one Shopify app platform" },
  ];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  // If accessed from Shopify embedded context (has embedded, host, or shop params),
  // redirect to the app dashboard
  if (
    url.searchParams.has("embedded") ||
    url.searchParams.has("host") ||
    url.searchParams.has("shop") ||
    url.searchParams.has("hmac") ||
    url.searchParams.has("id_token")
  ) {
    const params = url.searchParams.toString();
    return redirect(`/app?${params}`);
  }

  return null;
}

export default function Index() {
  return (
    <div>
      <h1>Nexify</h1>
      <p>Shopify Super-App</p>
    </div>
  );
}

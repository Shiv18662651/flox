import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => {
  return [
    { title: "Nexify - Shopify Super-App" },
    { name: "description", content: "All-in-one Shopify app platform" },
  ];
};

export default function Index() {
  return (
    <div>
      <h1>Nexify</h1>
      <p>Shopify Super-App</p>
    </div>
  );
}

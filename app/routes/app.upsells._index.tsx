import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { isFeatureAvailable } from "~/utils/plan-limits.server";
import type { Plan } from "@prisma/client";

// Requirements: 6.1, 6.5, 6.8, 6.9

const UPSELL_TYPES = ["post_purchase", "cart", "product_page", "thank_you"] as const;
type UpsellType = (typeof UPSELL_TYPES)[number];

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  const upsells = await db.upsell.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  const canAbTest = isFeatureAvailable(shop.plan, "ab_upsells");

  return json({
    upsells,
    shopId: shop.id,
    plan: shop.plan,
    canAbTest,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) {
    return json({ error: "Shop not found", success: false }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  switch (intent) {
    case "create": {
      const type = formData.get("type") as string;
      const title = formData.get("title") as string;
      const productId = formData.get("productId") as string;
      const discountPercent = parseInt(formData.get("discountPercent") as string, 10) || 0;

      if (!type || !UPSELL_TYPES.includes(type as UpsellType)) {
        return json({ error: "Invalid upsell type", success: false }, { status: 400 });
      }

      if (!title || title.trim().length === 0) {
        return json({ error: "Title is required", success: false }, { status: 400 });
      }

      if (discountPercent < 0 || discountPercent > 100) {
        return json({ error: "Discount must be between 0 and 100", success: false }, { status: 400 });
      }

      // STARTER plan: only one active upsell allowed
      if (!isFeatureAvailable(shop.plan, "ab_upsells")) {
        const activeCount = await db.upsell.count({
          where: { shopId: shop.id, isActive: true },
        });
        if (activeCount >= 1) {
          return json({
            error: "Starter plan allows only one active upsell. Upgrade to Growth or Pro for multiple offers.",
            success: false,
          }, { status: 403 });
        }
      }

      await db.upsell.create({
        data: {
          shopId: shop.id,
          type,
          title: title.trim(),
          productId: productId || null,
          discountPercent,
          isActive: true,
        },
      });

      return json({ success: true, error: null });
    }

    case "update": {
      const id = formData.get("id") as string;
      const title = formData.get("title") as string;
      const productId = formData.get("productId") as string;
      const discountPercent = parseInt(formData.get("discountPercent") as string, 10) || 0;
      const type = formData.get("type") as string;

      if (!id) {
        return json({ error: "Upsell ID is required", success: false }, { status: 400 });
      }

      if (discountPercent < 0 || discountPercent > 100) {
        return json({ error: "Discount must be between 0 and 100", success: false }, { status: 400 });
      }

      const upsell = await db.upsell.findFirst({
        where: { id, shopId: shop.id },
      });

      if (!upsell) {
        return json({ error: "Upsell not found", success: false }, { status: 404 });
      }

      await db.upsell.update({
        where: { id },
        data: {
          ...(title && { title: title.trim() }),
          ...(productId !== undefined && { productId: productId || null }),
          ...(discountPercent !== undefined && { discountPercent }),
          ...(type && UPSELL_TYPES.includes(type as UpsellType) && { type }),
        },
      });

      return json({ success: true, error: null });
    }

    case "delete": {
      const id = formData.get("id") as string;

      if (!id) {
        return json({ error: "Upsell ID is required", success: false }, { status: 400 });
      }

      const upsell = await db.upsell.findFirst({
        where: { id, shopId: shop.id },
      });

      if (!upsell) {
        return json({ error: "Upsell not found", success: false }, { status: 404 });
      }

      await db.upsell.delete({ where: { id } });

      return json({ success: true, error: null });
    }

    case "toggle-active": {
      const id = formData.get("id") as string;

      if (!id) {
        return json({ error: "Upsell ID is required", success: false }, { status: 400 });
      }

      const upsell = await db.upsell.findFirst({
        where: { id, shopId: shop.id },
      });

      if (!upsell) {
        return json({ error: "Upsell not found", success: false }, { status: 404 });
      }

      // If activating and on STARTER plan, check limit
      if (!upsell.isActive && !isFeatureAvailable(shop.plan, "ab_upsells")) {
        const activeCount = await db.upsell.count({
          where: { shopId: shop.id, isActive: true },
        });
        if (activeCount >= 1) {
          return json({
            error: "Starter plan allows only one active upsell. Upgrade to Growth or Pro for multiple offers.",
            success: false,
          }, { status: 403 });
        }
      }

      await db.upsell.update({
        where: { id },
        data: { isActive: !upsell.isActive },
      });

      return json({ success: true, error: null });
    }

    default:
      return json({ error: "Invalid action", success: false }, { status: 400 });
  }
}

export default function UpsellsDashboard() {
  const { upsells, plan, canAbTest } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("intent", "create");
    submit(formData, { method: "post" });
    setShowEditor(false);
  };

  const handleDelete = (id: string) => {
    const formData = new FormData();
    formData.set("intent", "delete");
    formData.set("id", id);
    submit(formData, { method: "post" });
  };

  const handleToggle = (id: string) => {
    const formData = new FormData();
    formData.set("intent", "toggle-active");
    formData.set("id", id);
    submit(formData, { method: "post" });
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1000px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "4px" }}>
            Upsell Offers
          </h1>
          <p style={{ color: "#6b7280", fontSize: "14px" }}>
            Create and manage upsell offers to increase average order value.
          </p>
        </div>
        <button
          onClick={() => { setShowEditor(true); setEditingId(null); }}
          style={{
            padding: "10px 20px",
            borderRadius: "8px",
            border: "none",
            fontWeight: "600",
            fontSize: "14px",
            cursor: "pointer",
            backgroundColor: "#3b82f6",
            color: "#ffffff",
          }}
        >
          + New Upsell
        </button>
      </div>

      {actionData?.error && (
        <div
          role="alert"
          style={{
            padding: "12px 16px",
            marginBottom: "16px",
            backgroundColor: "#fee2e2",
            border: "1px solid #fca5a5",
            borderRadius: "8px",
            color: "#991b1b",
          }}
        >
          {actionData.error}
        </div>
      )}

      {actionData?.success && (
        <div
          role="alert"
          style={{
            padding: "12px 16px",
            marginBottom: "16px",
            backgroundColor: "#d1fae5",
            border: "1px solid #6ee7b7",
            borderRadius: "8px",
            color: "#065f46",
          }}
        >
          Action completed successfully.
        </div>
      )}

      {!canAbTest && (
        <div style={{
          padding: "12px 16px",
          marginBottom: "16px",
          backgroundColor: "#fef3c7",
          border: "1px solid #fcd34d",
          borderRadius: "8px",
          color: "#92400e",
          fontSize: "14px",
        }}>
          You are on the {plan} plan. Only one active upsell is allowed. Upgrade to Growth or Pro for multiple offers and A/B testing.
        </div>
      )}

      {/* Upsell Editor */}
      {showEditor && (
        <div style={{
          border: "1px solid #e5e7eb",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "24px",
          backgroundColor: "#ffffff",
        }}>
          <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px" }}>
            {editingId ? "Edit Upsell" : "Create New Upsell"}
          </h2>
          <form onSubmit={handleCreate}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
              <div>
                <label htmlFor="upsell-type" style={{ display: "block", fontWeight: "500", marginBottom: "6px", fontSize: "14px" }}>
                  Placement Type
                </label>
                <select
                  id="upsell-type"
                  name="type"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "14px" }}
                >
                  <option value="post_purchase">Post Purchase (Thank-you page)</option>
                  <option value="cart">Cart (Sticky bar)</option>
                  <option value="product_page">Product Page</option>
                  <option value="thank_you">Thank You Page</option>
                </select>
              </div>
              <div>
                <label htmlFor="upsell-discount" style={{ display: "block", fontWeight: "500", marginBottom: "6px", fontSize: "14px" }}>
                  Discount Percentage
                </label>
                <input
                  id="upsell-discount"
                  name="discountPercent"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={0}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "14px" }}
                />
              </div>
            </div>
            <div style={{ marginBottom: "16px" }}>
              <label htmlFor="upsell-title" style={{ display: "block", fontWeight: "500", marginBottom: "6px", fontSize: "14px" }}>
                Headline
              </label>
              <input
                id="upsell-title"
                name="title"
                type="text"
                placeholder="e.g., Complete your look with..."
                required
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "14px" }}
              />
            </div>
            <div style={{ marginBottom: "16px" }}>
              <label htmlFor="upsell-product" style={{ display: "block", fontWeight: "500", marginBottom: "6px", fontSize: "14px" }}>
                Product ID (Shopify Product GID)
              </label>
              <input
                id="upsell-product"
                name="productId"
                type="text"
                placeholder="e.g., gid://shopify/Product/123456"
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "14px" }}
              />
            </div>
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                type="submit"
                style={{
                  padding: "10px 20px",
                  borderRadius: "8px",
                  border: "none",
                  fontWeight: "600",
                  fontSize: "14px",
                  cursor: "pointer",
                  backgroundColor: "#3b82f6",
                  color: "#ffffff",
                }}
              >
                Create Upsell
              </button>
              <button
                type="button"
                onClick={() => setShowEditor(false)}
                style={{
                  padding: "10px 20px",
                  borderRadius: "8px",
                  border: "1px solid #d1d5db",
                  fontWeight: "600",
                  fontSize: "14px",
                  cursor: "pointer",
                  backgroundColor: "#ffffff",
                  color: "#374151",
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Upsell List */}
      {upsells.length === 0 ? (
        <div style={{
          textAlign: "center",
          padding: "48px",
          border: "1px solid #e5e7eb",
          borderRadius: "12px",
          backgroundColor: "#f9fafb",
        }}>
          <p style={{ color: "#6b7280", fontSize: "16px" }}>
            No upsell offers yet. Create your first one to start increasing average order value.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {upsells.map((upsell) => {
            const conversionRate = upsell.impressions > 0
              ? ((upsell.conversions / upsell.impressions) * 100).toFixed(1)
              : "0.0";

            return (
              <div
                key={upsell.id}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: "12px",
                  padding: "20px",
                  backgroundColor: "#ffffff",
                  opacity: upsell.isActive ? 1 : 0.7,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <h3 style={{ fontSize: "16px", fontWeight: "600", margin: 0 }}>
                        {upsell.title}
                      </h3>
                      <span style={{
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontSize: "12px",
                        fontWeight: "500",
                        backgroundColor: upsell.isActive ? "#d1fae5" : "#f3f4f6",
                        color: upsell.isActive ? "#065f46" : "#6b7280",
                      }}>
                        {upsell.isActive ? "Active" : "Inactive"}
                      </span>
                      <span style={{
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontSize: "12px",
                        fontWeight: "500",
                        backgroundColor: "#ede9fe",
                        color: "#5b21b6",
                      }}>
                        {upsell.type.replace("_", " ")}
                      </span>
                    </div>
                    {upsell.discountPercent > 0 && (
                      <p style={{ color: "#6b7280", fontSize: "13px", margin: "4px 0 0 0" }}>
                        {upsell.discountPercent}% discount
                      </p>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => handleToggle(upsell.id)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        border: "1px solid #d1d5db",
                        fontSize: "13px",
                        cursor: "pointer",
                        backgroundColor: "#ffffff",
                      }}
                    >
                      {upsell.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => handleDelete(upsell.id)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        border: "1px solid #fca5a5",
                        fontSize: "13px",
                        cursor: "pointer",
                        backgroundColor: "#ffffff",
                        color: "#dc2626",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Performance Metrics */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: "16px",
                  marginTop: "16px",
                  paddingTop: "16px",
                  borderTop: "1px solid #f3f4f6",
                }}>
                  <div>
                    <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 2px 0" }}>Impressions</p>
                    <p style={{ fontSize: "18px", fontWeight: "600", margin: 0 }}>
                      {upsell.impressions.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 2px 0" }}>Conversions</p>
                    <p style={{ fontSize: "18px", fontWeight: "600", margin: 0 }}>
                      {upsell.conversions.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 2px 0" }}>Conversion Rate</p>
                    <p style={{ fontSize: "18px", fontWeight: "600", margin: 0 }}>
                      {conversionRate}%
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 2px 0" }}>Revenue</p>
                    <p style={{ fontSize: "18px", fontWeight: "600", margin: 0 }}>
                      ${upsell.revenue.toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

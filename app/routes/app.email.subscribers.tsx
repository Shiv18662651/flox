// Email subscribers route - subscriber management
// Requirements: 7.10, 7.11, 7.12

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useSearchParams, Link, useLocation } from "@remix-run/react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) throw new Response("Shop not found", { status: 404 });

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const filter = url.searchParams.get("filter") || "all"; // all, subscribed, unsubscribed
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = 50;

  const where: Record<string, unknown> = { shopId: shop.id };

  if (filter === "subscribed") where.isSubscribed = true;
  if (filter === "unsubscribed") where.isSubscribed = false;

  if (search) {
    where.OR = [
      { email: { contains: search, mode: "insensitive" } },
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName: { contains: search, mode: "insensitive" } },
    ];
  }

  const [customers, totalCount] = await Promise.all([
    db.customer.findMany({
      where: where as any,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isSubscribed: true,
        createdAt: true,
        totalOrders: true,
        totalSpent: true,
        lastOrderAt: true,
        avgOrderValue: true,
        churnRisk: true,
        predictedNextOrderAt: true,
        loyaltyPoints: true,
      } as any,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.customer.count({ where: where as any }),
  ]);

  // Calculate predictive analytics for customers that don't have them
  const now = new Date();
  const customersWithPredictions = customers.map((c: any) => {
    let churnRisk = c.churnRisk || "unknown";
    let predictedNextOrderAt = c.predictedNextOrderAt;

    if (churnRisk === "unknown") {
      const daysSinceOrder = c.lastOrderAt
        ? Math.floor((now.getTime() - new Date(c.lastOrderAt).getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      if (c.totalOrders === 0) churnRisk = "medium";
      else if (daysSinceOrder > 90) churnRisk = "high";
      else if (daysSinceOrder > 45) churnRisk = "medium";
      else churnRisk = "low";
    }

    if (!predictedNextOrderAt && c.totalOrders > 0) {
      const baseDate = c.lastOrderAt ? new Date(c.lastOrderAt) : new Date(c.createdAt);
      const predicted = new Date(baseDate);
      predicted.setDate(predicted.getDate() + 30);
      predictedNextOrderAt = predicted;
    }

    return { ...c, churnRisk, predictedNextOrderAt };
  });

  const subscribedCount = await db.customer.count({
    where: { shopId: shop.id, isSubscribed: true },
  });

  const totalPages = Math.ceil(totalCount / pageSize);

  // Aggregate prediction stats
  const churnStats = {
    high: customersWithPredictions.filter((c) => c.churnRisk === "high").length,
    medium: customersWithPredictions.filter((c) => c.churnRisk === "medium").length,
    low: customersWithPredictions.filter((c) => c.churnRisk === "low").length,
  };

  return json({
    customers: customersWithPredictions,
    totalCount,
    subscribedCount,
    unsubscribedCount: totalCount - subscribedCount,
    page,
    totalPages,
    search,
    filter,
    churnStats,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "unsubscribe") {
    const customerId = formData.get("customerId") as string;
    if (!customerId) return json({ error: "Customer ID required" }, { status: 400 });

    const customer = await db.customer.findUnique({
      where: { id: customerId },
      select: { id: true, shopId: true },
    });

    if (!customer || customer.shopId !== shop.id) {
      return json({ error: "Customer not found" }, { status: 404 });
    }

    await db.customer.update({
      where: { id: customerId },
      data: { isSubscribed: false },
    });

    return json({ success: true, message: "Customer unsubscribed" });
  }

  if (intent === "resubscribe") {
    const customerId = formData.get("customerId") as string;
    if (!customerId) return json({ error: "Customer ID required" }, { status: 400 });

    const customer = await db.customer.findUnique({
      where: { id: customerId },
      select: { id: true, shopId: true },
    });

    if (!customer || customer.shopId !== shop.id) {
      return json({ error: "Customer not found" }, { status: 404 });
    }

    await db.customer.update({
      where: { id: customerId },
      data: { isSubscribed: true },
    });

    return json({ success: true, message: "Customer resubscribed" });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

const EMAIL_NAV = [
  { label: "Campaigns", path: "/app/email/campaigns" },
  { label: "Templates", path: "/app/email/templates" },
  { label: "Automations", path: "/app/email/automations" },
  { label: "Subscribers", path: "/app/email/subscribers" },
  { label: "Signup Forms", path: "/app/email/signup-forms" },
];

function EmailNav() {
  const location = useLocation();
  return (
    <div style={{ display: "flex", gap: "4px", marginBottom: "24px", borderBottom: "1px solid #e5e7eb", paddingBottom: "12px" }}>
      {EMAIL_NAV.map((item) => {
        const isActive = location.pathname === item.path;
        return (
          <Link
            key={item.path}
            to={item.path}
            style={{
              padding: "8px 16px",
              fontSize: "14px",
              fontWeight: isActive ? "600" : "400",
              color: isActive ? "#3b82f6" : "#6b7280",
              borderBottom: isActive ? "2px solid #3b82f6" : "2px solid transparent",
              textDecoration: "none",
              marginBottom: "-14px",
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

export default function EmailSubscribersPage() {
  const { customers, totalCount, subscribedCount, unsubscribedCount, page, totalPages, search, filter, churnStats } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newSearch = formData.get("search") as string;
    setSearchParams({ search: newSearch, filter, page: "1" });
  };

  const handleFilter = (newFilter: string) => {
    setSearchParams({ search, filter: newFilter, page: "1" });
  };

  const handleUnsubscribe = (customerId: string) => {
    const formData = new FormData();
    formData.set("intent", "unsubscribe");
    formData.set("customerId", customerId);
    submit(formData, { method: "post" });
  };

  const handleResubscribe = (customerId: string) => {
    const formData = new FormData();
    formData.set("intent", "resubscribe");
    formData.set("customerId", customerId);
    submit(formData, { method: "post" });
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <EmailNav />
      <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "24px" }}>Subscribers</h1>

      {(actionData as { error?: string })?.error && (
        <div role="alert" style={{ padding: "12px", marginBottom: "16px", backgroundColor: "#fee2e2", borderRadius: "8px", color: "#991b1b" }}>
          {(actionData as { error: string }).error}
        </div>
      )}

      {(actionData as { message?: string })?.message && (
        <div role="status" style={{ padding: "12px", marginBottom: "16px", backgroundColor: "#d1fae5", borderRadius: "8px", color: "#065f46" }}>
          {(actionData as { message: string }).message}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "16px" }}>
        <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "8px", textAlign: "center" }}>
          <div style={{ fontSize: "24px", fontWeight: "bold" }}>{totalCount}</div>
          <div style={{ fontSize: "14px", color: "#6b7280" }}>Total Contacts</div>
        </div>
        <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "8px", textAlign: "center" }}>
          <div style={{ fontSize: "24px", fontWeight: "bold", color: "#059669" }}>{subscribedCount}</div>
          <div style={{ fontSize: "14px", color: "#6b7280" }}>Subscribed</div>
        </div>
        <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "8px", textAlign: "center" }}>
          <div style={{ fontSize: "24px", fontWeight: "bold", color: "#dc2626" }}>{unsubscribedCount}</div>
          <div style={{ fontSize: "14px", color: "#6b7280" }}>Unsubscribed</div>
        </div>
      </div>

      {/* Predictive Analytics - Churn Risk Stats */}
      <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "8px", marginBottom: "24px", backgroundColor: "#fafafa" }}>
        <h3 style={{ fontSize: "14px", fontWeight: "600", margin: "0 0 12px", color: "#374151" }}>Predictive Analytics</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
          <div style={{ padding: "12px", backgroundColor: "#fef2f2", borderRadius: "6px", textAlign: "center", border: "1px solid #fecaca" }}>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: "#dc2626" }}>{churnStats.high}</div>
            <div style={{ fontSize: "12px", color: "#991b1b" }}>High Churn Risk</div>
          </div>
          <div style={{ padding: "12px", backgroundColor: "#fef3c7", borderRadius: "6px", textAlign: "center", border: "1px solid #fde68a" }}>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: "#92400e" }}>{churnStats.medium}</div>
            <div style={{ fontSize: "12px", color: "#92400e" }}>Medium Churn Risk</div>
          </div>
          <div style={{ padding: "12px", backgroundColor: "#d1fae5", borderRadius: "6px", textAlign: "center", border: "1px solid #bbf7d0" }}>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: "#059669" }}>{churnStats.low}</div>
            <div style={{ fontSize: "12px", color: "#065f46" }}>Low Churn Risk</div>
          </div>
        </div>
      </div>

      {/* Search and Filter */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px", alignItems: "center" }}>
        <form onSubmit={handleSearch} style={{ display: "flex", gap: "8px", flex: 1 }}>
          <input
            name="search"
            type="text"
            defaultValue={search}
            placeholder="Search by email or name..."
            style={{ flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: "6px" }}
          />
          <button type="submit" style={{ padding: "8px 16px", backgroundColor: "#3b82f6", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}>
            Search
          </button>
        </form>

        <div style={{ display: "flex", gap: "4px" }}>
          {["all", "subscribed", "unsubscribed"].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => handleFilter(f)}
              style={{
                padding: "6px 12px",
                fontSize: "13px",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                cursor: "pointer",
                backgroundColor: filter === f ? "#3b82f6" : "#fff",
                color: filter === f ? "#fff" : "#374151",
              }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Subscriber Table */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ backgroundColor: "#f9fafb" }}>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "14px", fontWeight: "600" }}>Email</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "14px", fontWeight: "600" }}>Name</th>
              <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "14px", fontWeight: "600" }}>Status</th>
              <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", fontWeight: "600" }}>Orders</th>
              <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", fontWeight: "600" }}>Spent</th>
              <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "14px", fontWeight: "600" }}>Churn Risk</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "14px", fontWeight: "600" }}>Next Order</th>
              <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "14px", fontWeight: "600" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: "24px", textAlign: "center", color: "#6b7280" }}>
                  No subscribers found.
                </td>
              </tr>
            ) : (
              customers.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "12px 16px", fontSize: "14px" }}>{c.email}</td>
                  <td style={{ padding: "12px 16px", fontSize: "14px", color: "#6b7280" }}>
                    {[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "center" }}>
                    <span style={{
                      padding: "2px 8px",
                      borderRadius: "12px",
                      fontSize: "12px",
                      fontWeight: "500",
                      backgroundColor: c.isSubscribed ? "#d1fae5" : "#fee2e2",
                      color: c.isSubscribed ? "#065f46" : "#991b1b",
                    }}>
                      {c.isSubscribed ? "Subscribed" : "Unsubscribed"}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px" }}>{c.totalOrders}</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", color: "#6b7280" }}>
                    ${c.totalSpent?.toFixed(2) ?? "0.00"}
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "center" }}>
                    <span style={{
                      padding: "2px 8px",
                      borderRadius: "12px",
                      fontSize: "11px",
                      fontWeight: "600",
                      textTransform: "uppercase",
                      backgroundColor: c.churnRisk === "high" ? "#fef2f2" : c.churnRisk === "medium" ? "#fef3c7" : c.churnRisk === "low" ? "#d1fae5" : "#e5e7eb",
                      color: c.churnRisk === "high" ? "#dc2626" : c.churnRisk === "medium" ? "#92400e" : c.churnRisk === "low" ? "#059669" : "#374151",
                    }}>
                      {c.churnRisk === "unknown" ? "—" : c.churnRisk}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: "13px", color: "#6b7280" }}>
                    {c.predictedNextOrderAt
                      ? new Date(c.predictedNextOrderAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                      : "—"}
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "center" }}>
                    {c.isSubscribed ? (
                      <button
                        type="button"
                        onClick={() => handleUnsubscribe(c.id)}
                        style={{ padding: "4px 8px", fontSize: "12px", border: "1px solid #fca5a5", borderRadius: "4px", cursor: "pointer", backgroundColor: "#fff", color: "#dc2626" }}
                      >
                        Unsubscribe
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleResubscribe(c.id)}
                        style={{ padding: "4px 8px", fontSize: "12px", border: "1px solid #6ee7b7", borderRadius: "4px", cursor: "pointer", backgroundColor: "#fff", color: "#059669" }}
                      >
                        Resubscribe
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginTop: "16px" }}>
          {page > 1 && (
            <button
              type="button"
              onClick={() => setSearchParams({ search, filter, page: String(page - 1) })}
              style={{ padding: "6px 12px", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer", backgroundColor: "#fff" }}
            >
              Previous
            </button>
          )}
          <span style={{ padding: "6px 12px", fontSize: "14px", color: "#6b7280" }}>
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <button
              type="button"
              onClick={() => setSearchParams({ search, filter, page: String(page + 1) })}
              style={{ padding: "6px 12px", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer", backgroundColor: "#fff" }}
            >
              Next
            </button>
          )}
        </div>
      )}
    </div>
  );
}

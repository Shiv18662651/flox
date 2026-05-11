// Analytics Dashboard
// Requirements: 10.5, 10.6, 10.7, 10.8

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigate } from "@remix-run/react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { isFeatureAvailable } from "~/utils/plan-limits.server";

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

  // Parse date range from query params (default: last 30 days)
  const url = new URL(request.url);
  const endParam = url.searchParams.get("end");
  const startParam = url.searchParams.get("start");

  const endDate = endParam ? new Date(endParam) : new Date();
  endDate.setUTCHours(23, 59, 59, 999);

  const startDate = startParam
    ? new Date(startParam)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  startDate.setUTCHours(0, 0, 0, 0);

  // Fetch daily summaries for the date range
  const summaries = await db.analyticsDailySummary.findMany({
    where: {
      shopId: shop.id,
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: { date: "asc" },
  });

  // Aggregate totals
  let totalRevenue = 0;
  let totalOrders = 0;
  let totalPageViews = 0;
  let totalAddToCarts = 0;
  const uniqueVisitorSet = new Set<string>();

  // Channel attribution map
  const channelMap = new Map<
    string,
    { source: string; medium: string; revenue: number; orders: number }
  >();

  for (const summary of summaries) {
    totalRevenue += summary.totalRevenue;
    totalOrders += summary.totalOrders;
    totalPageViews += summary.pageViews;
    totalAddToCarts += summary.addToCarts;
    // uniqueVisitors is already a count per day/source/medium — sum them as approximation
    // (exact unique visitors would require raw event dedup across days)

    const channelKey = `${summary.source || "direct"}|${summary.medium || "none"}`;
    const existing = channelMap.get(channelKey);
    if (existing) {
      existing.revenue += summary.totalRevenue;
      existing.orders += summary.totalOrders;
    } else {
      channelMap.set(channelKey, {
        source: summary.source || "direct",
        medium: summary.medium || "none",
        revenue: summary.totalRevenue,
        orders: summary.totalOrders,
      });
    }
  }

  // Sum unique visitors across all summaries (approximation)
  const totalUniqueVisitors = summaries.reduce(
    (sum, s) => sum + s.uniqueVisitors,
    0
  );

  const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Channel attribution sorted by revenue
  const channels = Array.from(channelMap.values()).sort(
    (a, b) => b.revenue - a.revenue
  );

  // Feature gating for LTV report
  const canViewLtv = isFeatureAvailable(shop.plan, "ltv_report");

  return json({
    stats: {
      totalRevenue,
      totalOrders,
      aov,
      uniqueVisitors: totalUniqueVisitors,
      pageViews: totalPageViews,
      addToCarts: totalAddToCarts,
    },
    channels,
    canViewLtv,
    plan: shop.plan,
    dateRange: {
      start: startDate.toISOString().split("T")[0],
      end: endDate.toISOString().split("T")[0],
    },
  });
}

export default function AnalyticsDashboard() {
  const { stats, channels, canViewLtv, plan, dateRange } =
    useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const handleDateChange = (start: string, end: string) => {
    navigate(`/app/analytics?start=${start}&end=${end}`);
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
        }}
      >
        <div>
          <h1
            style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "4px" }}
          >
            Analytics
          </h1>
          <p style={{ color: "#6b7280" }}>
            Track revenue, visitors, and channel performance.
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <label htmlFor="start-date" style={{ fontSize: "13px", color: "#6b7280" }}>
            From:
          </label>
          <input
            id="start-date"
            type="date"
            defaultValue={dateRange.start}
            onChange={(e) => handleDateChange(e.target.value, dateRange.end)}
            style={{
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid #d1d5db",
              fontSize: "13px",
            }}
          />
          <label htmlFor="end-date" style={{ fontSize: "13px", color: "#6b7280" }}>
            To:
          </label>
          <input
            id="end-date"
            type="date"
            defaultValue={dateRange.end}
            onChange={(e) => handleDateChange(dateRange.start, e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid #d1d5db",
              fontSize: "13px",
            }}
          />
        </div>
      </div>

      {/* Key Metrics */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            padding: "16px",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            backgroundColor: "#fff",
          }}
        >
          <p
            style={{ color: "#6b7280", fontSize: "12px", marginBottom: "4px" }}
          >
            Total Revenue
          </p>
          <p style={{ fontSize: "24px", fontWeight: "bold" }}>
            ${stats.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div
          style={{
            padding: "16px",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            backgroundColor: "#fff",
          }}
        >
          <p
            style={{ color: "#6b7280", fontSize: "12px", marginBottom: "4px" }}
          >
            Total Orders
          </p>
          <p style={{ fontSize: "24px", fontWeight: "bold" }}>
            {stats.totalOrders.toLocaleString()}
          </p>
        </div>
        <div
          style={{
            padding: "16px",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            backgroundColor: "#fff",
          }}
        >
          <p
            style={{ color: "#6b7280", fontSize: "12px", marginBottom: "4px" }}
          >
            Average Order Value
          </p>
          <p style={{ fontSize: "24px", fontWeight: "bold" }}>
            ${stats.aov.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div
          style={{
            padding: "16px",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            backgroundColor: "#fff",
          }}
        >
          <p
            style={{ color: "#6b7280", fontSize: "12px", marginBottom: "4px" }}
          >
            Unique Visitors
          </p>
          <p style={{ fontSize: "24px", fontWeight: "bold" }}>
            {stats.uniqueVisitors.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Channel Attribution */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "24px",
          backgroundColor: "#fff",
        }}
      >
        <h2
          style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px" }}
        >
          Channel Attribution
        </h2>
        {channels.length === 0 ? (
          <p style={{ color: "#6b7280", fontSize: "14px" }}>
            No channel data available for this period.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px 12px",
                    fontSize: "13px",
                    color: "#6b7280",
                  }}
                >
                  Source
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px 12px",
                    fontSize: "13px",
                    color: "#6b7280",
                  }}
                >
                  Medium
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "8px 12px",
                    fontSize: "13px",
                    color: "#6b7280",
                  }}
                >
                  Revenue
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "8px 12px",
                    fontSize: "13px",
                    color: "#6b7280",
                  }}
                >
                  Orders
                </th>
              </tr>
            </thead>
            <tbody>
              {channels.map((channel, idx) => (
                <tr
                  key={`${channel.source}-${channel.medium}`}
                  style={{ borderBottom: "1px solid #f3f4f6" }}
                >
                  <td style={{ padding: "8px 12px", fontSize: "14px" }}>
                    {channel.source}
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: "14px" }}>
                    {channel.medium}
                  </td>
                  <td
                    style={{
                      padding: "8px 12px",
                      fontSize: "14px",
                      textAlign: "right",
                      fontWeight: "600",
                    }}
                  >
                    ${channel.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td
                    style={{
                      padding: "8px 12px",
                      fontSize: "14px",
                      textAlign: "right",
                    }}
                  >
                    {channel.orders}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* LTV Report (GROWTH/PRO only) */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: "12px",
          padding: "24px",
          backgroundColor: "#fff",
        }}
      >
        <h2
          style={{ fontSize: "18px", fontWeight: "600", marginBottom: "8px" }}
        >
          Customer LTV &amp; Cohort Retention
        </h2>
        {!canViewLtv ? (
          <p style={{ color: "#6b7280", fontSize: "14px" }}>
            Customer LTV reports and cohort retention charts are available on the
            Growth or Pro plan.{" "}
            <a href="/app/billing" style={{ color: "#3b82f6" }}>
              Upgrade now
            </a>
          </p>
        ) : (
          <div>
            <p style={{ color: "#6b7280", fontSize: "14px", marginBottom: "16px" }}>
              Customer lifetime value analysis and cohort retention tracking.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "16px",
              }}
            >
              <div
                style={{
                  padding: "16px",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  backgroundColor: "#f9fafb",
                }}
              >
                <p
                  style={{
                    color: "#6b7280",
                    fontSize: "12px",
                    marginBottom: "4px",
                  }}
                >
                  Avg. Customer LTV
                </p>
                <p style={{ fontSize: "20px", fontWeight: "bold" }}>
                  ${stats.totalOrders > 0
                    ? (stats.totalRevenue / stats.uniqueVisitors || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : "0.00"}
                </p>
                <p style={{ color: "#6b7280", fontSize: "11px", marginTop: "4px" }}>
                  Revenue per unique visitor (approximation)
                </p>
              </div>
              <div
                style={{
                  padding: "16px",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  backgroundColor: "#f9fafb",
                }}
              >
                <p
                  style={{
                    color: "#6b7280",
                    fontSize: "12px",
                    marginBottom: "4px",
                  }}
                >
                  Conversion Rate
                </p>
                <p style={{ fontSize: "20px", fontWeight: "bold" }}>
                  {stats.uniqueVisitors > 0
                    ? ((stats.totalOrders / stats.uniqueVisitors) * 100).toFixed(2)
                    : "0.00"}
                  %
                </p>
                <p style={{ color: "#6b7280", fontSize: "11px", marginTop: "4px" }}>
                  Orders / Unique Visitors
                </p>
              </div>
            </div>
            <p style={{ color: "#9ca3af", fontSize: "12px", marginTop: "16px" }}>
              Full cohort retention chart coming soon.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

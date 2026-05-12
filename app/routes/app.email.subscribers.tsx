// Email subscribers route - subscriber management
// Requirements: 7.10, 7.11, 7.12

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useSearchParams, Link, useLocation } from "@remix-run/react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { Icon } from "~/components/Icon";

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
    <div className="flex gap-xs mb-lg border-b border-outline-variant pb-sm">
      {EMAIL_NAV.map((item) => {
        const isActive = location.pathname === item.path;
        return (
          <Link
            key={item.path}
            to={item.path}
            className={`px-md py-xs text-label-md font-medium border-b-2 -mb-[2px] transition-colors ${
              isActive
                ? "text-primary border-primary"
                : "text-on-surface-variant border-transparent hover:text-on-surface"
            }`}
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
    <main className="p-lg max-w-container-max mx-auto font-sans pb-24">
      <EmailNav />
      <h1 className="text-display-lg font-bold text-on-surface mb-lg">Subscribers</h1>

      {(actionData as { error?: string })?.error && (
        <div role="alert" className="mb-md px-sm py-xs rounded-lg bg-error-container text-on-error-container flex items-center gap-xs text-label-md">
          <Icon name="error" size={16} />
          {(actionData as { error: string }).error}
        </div>
      )}

      {(actionData as { message?: string })?.message && (
        <div role="status" className="mb-md px-sm py-xs rounded-lg bg-secondary-container text-on-secondary-container flex items-center gap-xs text-label-md">
          <Icon name="check_circle" size={16} />
          {(actionData as { message: string }).message}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-md mb-md">
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md text-center shadow-sm">
          <div className="text-headline-md font-bold text-on-surface">{totalCount}</div>
          <div className="text-body-md text-on-surface-variant">Total Contacts</div>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md text-center shadow-sm">
          <div className="text-headline-md font-bold text-on-secondary-container">{subscribedCount}</div>
          <div className="text-body-md text-on-surface-variant">Subscribed</div>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md text-center shadow-sm">
          <div className="text-headline-md font-bold text-on-error-container">{unsubscribedCount}</div>
          <div className="text-body-md text-on-surface-variant">Unsubscribed</div>
        </div>
      </div>

      {/* Predictive Analytics - Churn Risk Stats */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md mb-lg shadow-sm">
        <h3 className="text-label-md font-semibold text-on-surface mb-sm">Predictive Analytics</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-md">
          <div className="bg-error-container border border-error-container rounded-lg p-sm text-center">
            <div className="text-headline-sm font-bold text-on-error-container">{churnStats.high}</div>
            <div className="text-label-sm text-on-error-container">High Churn Risk</div>
          </div>
          <div className="bg-tertiary-fixed border border-tertiary-fixed-dim rounded-lg p-sm text-center">
            <div className="text-headline-sm font-bold text-on-tertiary-fixed-variant">{churnStats.medium}</div>
            <div className="text-label-sm text-on-tertiary-fixed-variant">Medium Churn Risk</div>
          </div>
          <div className="bg-secondary-container border border-secondary-container rounded-lg p-sm text-center">
            <div className="text-headline-sm font-bold text-on-secondary-container">{churnStats.low}</div>
            <div className="text-label-sm text-on-secondary-container">Low Churn Risk</div>
          </div>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-sm mb-md items-stretch sm:items-center">
        <form onSubmit={handleSearch} className="flex gap-xs flex-1">
          <div className="relative flex-1">
            <Icon name="search" size={18} className="absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input
              name="search"
              type="text"
              defaultValue={search}
              placeholder="Search by email or name..."
              className="w-full pl-[36px] pr-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition"
            />
          </div>
          <button type="submit" className="px-sm py-xs rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:opacity-90 transition-opacity">
            Search
          </button>
        </form>

        <div className="flex gap-xs">
          {["all", "subscribed", "unsubscribed"].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => handleFilter(f)}
              className={`px-sm py-[6px] rounded-lg text-label-md font-semibold transition-colors ${
                filter === f
                  ? "bg-primary text-on-primary"
                  : "border border-outline-variant text-on-surface hover:bg-surface-container-low"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Subscriber Table */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-surface-container-low border-b border-outline-variant">
              <th className="px-md py-sm text-left text-label-md font-semibold text-on-surface">Email</th>
              <th className="px-md py-sm text-left text-label-md font-semibold text-on-surface">Name</th>
              <th className="px-md py-sm text-center text-label-md font-semibold text-on-surface">Status</th>
              <th className="px-md py-sm text-right text-label-md font-semibold text-on-surface">Orders</th>
              <th className="px-md py-sm text-right text-label-md font-semibold text-on-surface">Spent</th>
              <th className="px-md py-sm text-center text-label-md font-semibold text-on-surface">Churn Risk</th>
              <th className="px-md py-sm text-left text-label-md font-semibold text-on-surface">Next Order</th>
              <th className="px-md py-sm text-center text-label-md font-semibold text-on-surface">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {customers.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-xl px-md text-center text-on-surface-variant">
                  <div className="flex flex-col items-center justify-center gap-sm">
                    <Icon name="group" size={48} className="opacity-40" />
                    <p className="text-body-lg font-medium">No subscribers found</p>
                  </div>
                </td>
              </tr>
            ) : (
              customers.map((c) => (
                <tr key={c.id} className="hover:bg-surface-container-low transition-colors">
                  <td className="px-md py-sm text-body-md text-on-surface">{c.email}</td>
                  <td className="px-md py-sm text-body-md text-on-surface-variant">
                    {[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-md py-sm text-center">
                    <span className={`inline-block px-sm py-[2px] rounded-full text-label-sm font-semibold ${
                      c.isSubscribed ? "bg-secondary-container text-on-secondary-container" : "bg-error-container text-on-error-container"
                    }`}>
                      {c.isSubscribed ? "Subscribed" : "Unsubscribed"}
                    </span>
                  </td>
                  <td className="px-md py-sm text-right text-body-md text-on-surface">{c.totalOrders}</td>
                  <td className="px-md py-sm text-right text-body-md text-on-surface-variant">
                    ${c.totalSpent?.toFixed(2) ?? "0.00"}
                  </td>
                  <td className="px-md py-sm text-center">
                    <span className={`inline-block px-sm py-[2px] rounded-full text-label-sm font-semibold uppercase ${
                      c.churnRisk === "high" ? "bg-error-container text-on-error-container" :
                      c.churnRisk === "medium" ? "bg-tertiary-fixed text-on-tertiary-fixed-variant" :
                      c.churnRisk === "low" ? "bg-secondary-container text-on-secondary-container" :
                      "bg-surface-container-high text-on-surface-variant"
                    }`}>
                      {c.churnRisk === "unknown" ? "—" : c.churnRisk}
                    </span>
                  </td>
                  <td className="px-md py-sm text-body-sm text-on-surface-variant">
                    {c.predictedNextOrderAt
                      ? new Date(c.predictedNextOrderAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                      : "—"}
                  </td>
                  <td className="px-md py-sm text-center">
                    {c.isSubscribed ? (
                      <button
                        type="button"
                        onClick={() => handleUnsubscribe(c.id)}
                        className="px-sm py-[4px] text-label-sm font-semibold border border-error-container text-on-error-container rounded-md hover:bg-error-container transition-colors"
                      >
                        Unsubscribe
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleResubscribe(c.id)}
                        className="px-sm py-[4px] text-label-sm font-semibold border border-secondary-container text-on-secondary-container rounded-md hover:bg-secondary-container transition-colors"
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
        <div className="flex items-center justify-center gap-xs mt-md">
          {page > 1 && (
            <button
              type="button"
              onClick={() => setSearchParams({ search, filter, page: String(page - 1) })}
              className="px-sm py-xs rounded-lg border border-outline-variant text-label-md font-semibold text-on-surface hover:bg-surface-container-low transition-colors"
            >
              Previous
            </button>
          )}
          <span className="px-sm py-xs text-body-md text-on-surface-variant">
            Page <span className="font-semibold text-on-surface">{page}</span> of <span className="font-semibold text-on-surface">{totalPages}</span>
          </span>
          {page < totalPages && (
            <button
              type="button"
              onClick={() => setSearchParams({ search, filter, page: String(page + 1) })}
              className="px-sm py-xs rounded-lg border border-outline-variant text-label-md font-semibold text-on-surface hover:bg-surface-container-low transition-colors"
            >
              Next
            </button>
          )}
        </div>
      )}
    </main>
  );
}

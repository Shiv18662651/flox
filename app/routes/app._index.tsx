import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Icon } from "~/components/Icon";

export async function loader() {
  return json({
    merchantName: "Sunrise Goods",
    performanceStat: "+18% revenue this month",
    metrics: [
      { icon: "payments", label: "Total Revenue", value: "$45,230", badge: "+12%" },
      { icon: "group", label: "Active Subscribers", value: "1,240", badge: "+5%" },
      { icon: "rate_review", label: "Reviews Collected", value: "856", badge: "+8%" },
      { icon: "card_membership", label: "Loyalty Members", value: "2,100", badge: "+15%" },
    ],
    quickActions: [
      {
        icon: "rate_review",
        title: "Reviews",
        description: "Approve, reply and curate customer feedback.",
        to: "/app/reviews",
        buttonLabel: "Manage Reviews",
      },
      {
        icon: "mail",
        title: "Email",
        description: "Create and schedule your next campaign.",
        to: "/app/email/campaigns",
        buttonLabel: "Email Marketing",
      },
      {
        icon: "loyalty",
        title: "Loyalty",
        description: "Configure rewards and membership tiers.",
        to: "/app/loyalty",
        buttonLabel: "Loyalty Program",
      },
      {
        icon: "campaign",
        title: "FOMO",
        description: "Set up social proof popups for your store.",
        to: "/app/fomo",
        buttonLabel: "FOMO Alerts",
      },
      {
        icon: "group_add",
        title: "Referrals",
        description: "Incentivize customers to share your store.",
        to: "/app/referrals",
        buttonLabel: "Referral Engine",
      },
      {
        icon: "search",
        title: "SEO",
        description: "Audit and improve your search rankings.",
        to: "/app/seo",
        buttonLabel: "SEO Optimizer",
      },
    ],
    checklistItems: [
      {
        done: true,
        title: "Connect your Shopify store",
        description: "Sync products and orders automatically.",
      },
      {
        done: false,
        title: "Set up your first review campaign",
        description: "Email customers to ask for feedback.",
      },
      {
        done: false,
        title: "Design your loyalty widget",
        description: "Customize colors to match your brand.",
      },
    ],
    recentActivity: [
      {
        iconBg: "bg-secondary-container",
        icon: "star",
        name: "Sarah J.",
        content: "left a 5-star review.",
        time: "2 minutes ago",
      },
      {
        iconBg: "bg-primary-fixed",
        icon: "mail",
        name: null,
        content: "Flash Sale Email Campaign sent.",
        time: "45 minutes ago",
      },
      {
        iconBg: "bg-tertiary-fixed",
        icon: "redeem",
        name: "David L.",
        content: "redeemed 500 points.",
        time: "2 hours ago",
      },
      {
        iconBg: "bg-secondary-container",
        icon: "person_add",
        name: null,
        content: "New subscriber from FOMO popup.",
        time: "5 hours ago",
      },
      {
        iconBg: "bg-primary-fixed",
        icon: "manage_search",
        name: null,
        content: "SEO health check completed.",
        time: "Yesterday",
      },
    ],
  });
}

export default function AppDashboard() {
  const { merchantName, performanceStat, metrics, quickActions, checklistItems, recentActivity } =
    useLoaderData<typeof loader>();

  return (
    <main className="min-h-screen bg-background p-md">
      <div className="max-w-container-max mx-auto space-y-lg">

        {/* ── Welcome Banner ── */}
        <section className="relative overflow-hidden bg-primary rounded-xl px-lg py-md flex items-center justify-between shadow-md">
          {/* Left content */}
          <div className="flex-1 min-w-0 pr-md">
            <p className="text-label-md text-secondary-container mb-xs tracking-wide uppercase">
              Dashboard
            </p>
            <h1 className="text-display-lg text-on-primary font-bold mb-xs leading-tight">
              Welcome back,<br />
              <span className="text-secondary-container">{merchantName}</span>
            </h1>
            <p className="text-body-lg text-on-primary opacity-80 mb-md">
              {performanceStat} — keep the momentum going.
            </p>
            <Link
              to="/app/analytics"
              className="inline-flex items-center gap-xs bg-secondary-container text-on-secondary-container text-label-md font-semibold px-md py-2 rounded-lg hover:opacity-90 transition-opacity"
            >
              <Icon name="bar_chart" size={18} />
              View Analytics
            </Link>
          </div>

          {/* Right illustration */}
          <div className="hidden md:flex items-center justify-center shrink-0">
            <div className="w-36 h-36 rounded-full bg-primary-container flex items-center justify-center opacity-90">
              <Icon name="storefront" size={72} className="text-secondary-container" />
            </div>
          </div>

          {/* Decorative circles */}
          <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-primary-container opacity-40 pointer-events-none" />
          <div className="absolute -bottom-10 right-24 w-28 h-28 rounded-full bg-primary-container opacity-30 pointer-events-none" />
        </section>

        {/* ── Metric Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-md">
          {metrics.map((card) => (
            <div
              key={card.label}
              className="bg-surface-container-lowest rounded-xl p-md metric-card-outline shadow-sm flex flex-col gap-xs"
            >
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center">
                  <Icon name={card.icon} size={22} className="text-primary" />
                </div>
                <span className="text-label-sm font-semibold text-on-secondary-container bg-secondary-container px-2 py-0.5 rounded-full">
                  {card.badge}
                </span>
              </div>
              <p className="text-body-md text-on-surface-variant mt-xs">{card.label}</p>
              <p className="text-headline-md font-bold text-on-surface">{card.value}</p>
            </div>
          ))}
        </div>

        {/* ── Main Two-Column Layout ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-lg">

          {/* Left column */}
          <div className="lg:col-span-8 space-y-lg">

            {/* Quick Actions */}
            <section>
              <div className="flex items-center justify-between mb-md">
                <h2 className="text-headline-sm font-semibold text-on-surface">Quick Actions</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-md">
                {quickActions.map((action) => (
                  <div
                    key={action.to}
                    className="bg-surface-container-lowest rounded-xl p-md metric-card-outline shadow-sm flex flex-col justify-between hover:border-primary transition-colors group"
                  >
                    <div>
                      <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center mb-sm">
                        <Icon name={action.icon} size={22} className="text-primary" />
                      </div>
                      <h3 className="text-label-md font-semibold text-on-surface mb-xs">{action.title}</h3>
                      <p className="text-label-sm text-on-surface-variant mb-md leading-relaxed">
                        {action.description}
                      </p>
                    </div>
                    <Link
                      to={action.to}
                      className="block w-full text-center bg-primary text-on-primary text-label-sm font-semibold py-2 px-md rounded-lg hover:bg-primary-container transition-colors"
                    >
                      {action.buttonLabel}
                    </Link>
                  </div>
                ))}
              </div>
            </section>

            {/* Getting Started Checklist */}
            <section className="bg-surface-container-lowest rounded-xl metric-card-outline shadow-sm overflow-hidden">
              <div className="px-md py-sm border-b border-outline-variant bg-surface-container-low">
                <h2 className="text-headline-sm font-semibold text-on-surface">Getting Started</h2>
                <p className="text-body-md text-on-surface-variant mt-xs">
                  Complete these steps to optimize your store setup.
                </p>
              </div>
              <ul className="divide-y divide-outline-variant">
                {checklistItems.map((item) => (
                  <li
                    key={item.title}
                    className="px-md py-sm flex items-center justify-between gap-md hover:bg-surface-container-low transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-md">
                      {/* Checkbox */}
                      <div
                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                          item.done
                            ? "border-primary bg-primary"
                            : "border-outline-variant group-hover:border-primary"
                        }`}
                      >
                        {item.done && (
                          <Icon name="check" size={14} className="text-on-primary" />
                        )}
                      </div>
                      <div>
                        <p
                          className={`text-label-md font-semibold ${
                            item.done ? "line-through text-on-surface-variant" : "text-on-surface"
                          }`}
                        >
                          {item.title}
                        </p>
                        <p className="text-label-sm text-on-surface-variant mt-0.5">{item.description}</p>
                      </div>
                    </div>
                    <Icon name="chevron_right" size={20} className="text-outline-variant group-hover:text-primary transition-colors shrink-0" />
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* Right column — Recent Activity */}
          <div className="lg:col-span-4">
            <section className="bg-surface-container-lowest rounded-xl metric-card-outline shadow-sm flex flex-col h-full">
              <div className="px-md py-sm border-b border-outline-variant">
                <h2 className="text-headline-sm font-semibold text-on-surface">Recent Activity</h2>
              </div>

              <ul className="flex-1 divide-y divide-outline-variant overflow-y-auto">
                {recentActivity.map((item, index) => (
                  <li key={index} className="px-md py-sm flex gap-sm items-start hover:bg-surface-container-low transition-colors">
                    <div
                      className={`w-9 h-9 rounded-full ${item.iconBg} flex items-center justify-center shrink-0 mt-0.5`}
                    >
                      <Icon name={item.icon} size={18} className="text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-body-md text-on-surface leading-snug">
                        {item.name && (
                          <span className="font-semibold">{item.name} </span>
                        )}
                        {item.content}
                      </p>
                      <p className="text-label-sm text-on-surface-variant mt-0.5">{item.time}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="px-md py-sm border-t border-outline-variant">
                <Link
                  to="/app/analytics"
                  className="flex items-center gap-xs text-primary text-label-md font-semibold hover:underline transition-colors"
                >
                  View Full History
                  <Icon name="arrow_forward" size={16} />
                </Link>
              </div>
            </section>
          </div>
        </div>

      </div>
    </main>
  );
}

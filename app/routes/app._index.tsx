import { Link } from "@remix-run/react";

export default function AppDashboard() {
  const links = [
    { to: "/app/reviews", label: "Product Reviews" },
    { to: "/app/fomo", label: "FOMO Popups" },
    { to: "/app/upsells", label: "Upsell Widgets" },
    { to: "/app/email/templates", label: "Email Templates" },
    { to: "/app/email/campaigns", label: "Email Campaigns" },
    { to: "/app/email/automations", label: "Email Automations" },
    { to: "/app/email/subscribers", label: "Subscribers" },
    { to: "/app/loyalty", label: "Loyalty Program" },
    { to: "/app/seo", label: "SEO Automation" },
    { to: "/app/analytics", label: "Analytics" },
    { to: "/app/referrals", label: "Referral Program" },
    { to: "/app/billing", label: "Billing & Plans" },
  ];

  return (
    <div style={{ padding: "24px", maxWidth: "900px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "8px" }}>
        Nexify Dashboard
      </h1>
      <p style={{ color: "#6b7280", marginBottom: "24px" }}>
        Welcome to your all-in-one Shopify growth platform.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: "12px",
        }}
      >
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            style={{
              display: "block",
              padding: "16px",
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              textDecoration: "none",
              color: "#111827",
              fontWeight: "500",
              fontSize: "14px",
              backgroundColor: "#ffffff",
            }}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

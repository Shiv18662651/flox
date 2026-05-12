import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, Link, useLocation } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";

const FORM_TYPES = [
  { value: "popup", label: "Popup" },
  { value: "flyout", label: "Flyout" },
  { value: "banner", label: "Banner" },
  { value: "embedded", label: "Embedded" },
];

const TRIGGERS = [
  { value: "delay", label: "Time Delay" },
  { value: "exit_intent", label: "Exit Intent" },
  { value: "scroll", label: "Scroll Percentage" },
  { value: "manual", label: "Manual (Button Click)" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) throw new Response("Shop not found", { status: 404 });

  const forms = await (db as any).signupForm.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  return json({ forms, shopId: shop.id });
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

  if (intent === "create") {
    const name = formData.get("name") as string;
    const formType = formData.get("formType") as string;
    const trigger = formData.get("trigger") as string;
    const triggerValue = formData.get("triggerValue") as string;
    const headline = formData.get("headline") as string;
    const subheadline = formData.get("subheadline") as string;
    const ctaText = formData.get("ctaText") as string;
    const successMessage = formData.get("successMessage") as string;
    const bgColor = formData.get("bgColor") as string;
    const textColor = formData.get("textColor") as string;
    const buttonColor = formData.get("buttonColor") as string;
    const discountCode = formData.get("discountCode") as string;

    if (!name || !headline) {
      return json({ error: "Name and headline are required" }, { status: 400 });
    }

    const form = await (db as any).signupForm.create({
      data: {
        shopId: shop.id,
        name,
        formType,
        trigger,
        triggerValue: triggerValue || null,
        headline,
        subheadline: subheadline || null,
        ctaText: ctaText || "Subscribe",
        successMessage: successMessage || "Thanks for subscribing!",
        bgColor: bgColor || "#005440",
        textColor: textColor || "#ffffff",
        buttonColor: buttonColor || "#006c4e",
        discountCode: discountCode || null,
      },
    });

    return json({ success: true, form, message: "Signup form created" });
  }

  if (intent === "toggle") {
    const formId = formData.get("formId") as string;
    const isActive = formData.get("isActive") === "true";

    await (db as any).signupForm.update({
      where: { id: formId },
      data: { isActive },
    });

    return json({ success: true, message: `Form ${isActive ? "activated" : "deactivated"}` });
  }

  if (intent === "delete") {
    const formId = formData.get("formId") as string;
    await (db as any).signupForm.delete({ where: { id: formId } });
    return json({ success: true, message: "Form deleted" });
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

export default function SignupFormsPage() {
  const loaderData = useLoaderData<typeof loader>() as unknown as { forms: Array<{ id: string; name: string; formType: string; trigger: string; impressions: number; conversions: number; isActive: boolean }> };
  const { forms } = loaderData;
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [formType, setFormType] = useState("popup");
  const [trigger, setTrigger] = useState("delay");
  const [triggerValue, setTriggerValue] = useState("5");
  const [headline, setHeadline] = useState("Join our newsletter");
  const [subheadline, setSubheadline] = useState("Get 10% off your first order");
  const [ctaText, setCtaText] = useState("Subscribe");
  const [successMessage, setSuccessMessage] = useState("Thanks for subscribing!");
  const [bgColor, setBgColor] = useState("#005440");
  const [textColor, setTextColor] = useState("#ffffff");
  const [buttonColor, setButtonColor] = useState("#006c4e");
  const [discountCode, setDiscountCode] = useState("WELCOME10");

  const handleCreate = () => {
    const fd = new FormData();
    fd.set("intent", "create");
    fd.set("name", name);
    fd.set("formType", formType);
    fd.set("trigger", trigger);
    fd.set("triggerValue", triggerValue);
    fd.set("headline", headline);
    fd.set("subheadline", subheadline);
    fd.set("ctaText", ctaText);
    fd.set("successMessage", successMessage);
    fd.set("bgColor", bgColor);
    fd.set("textColor", textColor);
    fd.set("buttonColor", buttonColor);
    fd.set("discountCode", discountCode);
    submit(fd, { method: "post" });
    setShowForm(false);
    setName("");
  };

  const handleToggle = (formId: string, current: boolean) => {
    const fd = new FormData();
    fd.set("intent", "toggle");
    fd.set("formId", formId);
    fd.set("isActive", String(!current));
    submit(fd, { method: "post" });
  };

  const handleDelete = (formId: string) => {
    if (!confirm("Delete this form?")) return;
    const fd = new FormData();
    fd.set("intent", "delete");
    fd.set("formId", formId);
    submit(fd, { method: "post" });
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <EmailNav />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>Signup Forms</h1>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          style={{ padding: "10px 20px", backgroundColor: "#3b82f6", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
        >
          {showForm ? "Cancel" : "New Form"}
        </button>
      </div>

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

      {showForm && (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px", marginBottom: "24px", backgroundColor: "#fff" }}>
          <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px" }}>Create Signup Form</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
            <div>
              <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>Form Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }} placeholder="Newsletter Popup" />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>Form Type</label>
              <select value={formType} onChange={(e) => setFormType(e.target.value)} style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }}>
                {FORM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>Trigger</label>
              <select value={trigger} onChange={(e) => setTrigger(e.target.value)} style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }}>
                {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>
                Trigger Value {trigger === "delay" ? "(seconds)" : trigger === "scroll" ? "(%)" : ""}
              </label>
              <input type="text" value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>Headline</label>
              <input type="text" value={headline} onChange={(e) => setHeadline(e.target.value)} style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>Subheadline</label>
              <input type="text" value={subheadline} onChange={(e) => setSubheadline(e.target.value)} style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>CTA Text</label>
              <input type="text" value={ctaText} onChange={(e) => setCtaText(e.target.value)} style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>Discount Code (optional)</label>
              <input type="text" value={discountCode} onChange={(e) => setDiscountCode(e.target.value)} style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }} placeholder="WELCOME10" />
            </div>
          </div>

          {/* Live Preview */}
          <div style={{ marginTop: "16px", marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "8px" }}>Live Preview</label>
            <div style={{ padding: "24px", borderRadius: "8px", textAlign: "center", backgroundColor: bgColor, color: textColor }}>
              <h3 style={{ margin: "0 0 8px", fontSize: "20px" }}>{headline}</h3>
              <p style={{ margin: "0 0 16px", fontSize: "14px", opacity: 0.9 }}>{subheadline}</p>
              <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                <input type="email" placeholder="Enter your email" style={{ padding: "8px 12px", borderRadius: "4px", border: "none", width: "200px" }} readOnly />
                <button type="button" style={{ padding: "8px 16px", backgroundColor: buttonColor, color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}>
                  {ctaText}
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
            <div>
              <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>Background Color</label>
              <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} style={{ width: "100%", height: "36px", border: "1px solid #d1d5db", borderRadius: "6px" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>Text Color</label>
              <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} style={{ width: "100%", height: "36px", border: "1px solid #d1d5db", borderRadius: "6px" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>Button Color</label>
              <input type="color" value={buttonColor} onChange={(e) => setButtonColor(e.target.value)} style={{ width: "100%", height: "36px", border: "1px solid #d1d5db", borderRadius: "6px" }} />
            </div>
          </div>

          <button type="button" onClick={handleCreate} style={{ padding: "8px 16px", backgroundColor: "#3b82f6", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}>
            Create Form
          </button>
        </div>
      )}

      {/* Forms List */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ backgroundColor: "#f9fafb" }}>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "14px", fontWeight: "600" }}>Name</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "14px", fontWeight: "600" }}>Type</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "14px", fontWeight: "600" }}>Trigger</th>
              <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", fontWeight: "600" }}>Impressions</th>
              <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", fontWeight: "600" }}>Conversions</th>
              <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "14px", fontWeight: "600" }}>Status</th>
              <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "14px", fontWeight: "600" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {forms.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: "24px", textAlign: "center", color: "#6b7280" }}>
                  No signup forms yet. Create your first one!
                </td>
              </tr>
            ) : (
              forms.map((f) => (
                <tr key={f.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "12px 16px", fontSize: "14px" }}>{f.name}</td>
                  <td style={{ padding: "12px 16px", fontSize: "14px" }}>{f.formType}</td>
                  <td style={{ padding: "12px 16px", fontSize: "14px" }}>{f.trigger}</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px" }}>{f.impressions}</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px" }}>{f.conversions}</td>
                  <td style={{ padding: "12px 16px", textAlign: "center" }}>
                    <span style={{
                      padding: "2px 8px",
                      borderRadius: "12px",
                      fontSize: "12px",
                      fontWeight: "500",
                      backgroundColor: f.isActive ? "#d1fae5" : "#e5e7eb",
                      color: f.isActive ? "#065f46" : "#374151",
                    }}>
                      {f.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "center" }}>
                    <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                      <button
                        type="button"
                        onClick={() => handleToggle(f.id, f.isActive)}
                        style={{ padding: "4px 8px", fontSize: "12px", border: "1px solid #d1d5db", borderRadius: "4px", cursor: "pointer", backgroundColor: "#fff" }}
                      >
                        {f.isActive ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(f.id)}
                        style={{ padding: "4px 8px", fontSize: "12px", border: "1px solid #fca5a5", borderRadius: "4px", cursor: "pointer", backgroundColor: "#fff", color: "#dc2626" }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

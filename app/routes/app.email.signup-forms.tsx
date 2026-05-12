import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, Link, useLocation } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { Icon } from "~/components/Icon";

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
    <main className="p-lg max-w-container-max mx-auto font-sans pb-24">
      <EmailNav />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-md mb-lg">
        <h1 className="text-display-lg font-bold text-on-surface">Signup Forms</h1>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-xs bg-primary text-on-primary text-label-md font-semibold px-md py-xs rounded-lg hover:opacity-90 transition-opacity shadow-sm"
        >
          <Icon name="add" size={18} />
          {showForm ? "Cancel" : "New Form"}
        </button>
      </div>

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

      {showForm && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md mb-lg shadow-sm">
          <h2 className="text-headline-sm font-semibold text-on-surface mb-md">Create Signup Form</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-md mb-md">
            <div>
              <label className="block text-label-md font-medium text-on-surface mb-xs">Form Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition" placeholder="Newsletter Popup" />
            </div>
            <div>
              <label className="block text-label-md font-medium text-on-surface mb-xs">Form Type</label>
              <select value={formType} onChange={(e) => setFormType(e.target.value)} className="w-full px-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition appearance-none">
                {FORM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-label-md font-medium text-on-surface mb-xs">Trigger</label>
              <select value={trigger} onChange={(e) => setTrigger(e.target.value)} className="w-full px-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition appearance-none">
                {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-label-md font-medium text-on-surface mb-xs">
                Trigger Value {trigger === "delay" ? "(seconds)" : trigger === "scroll" ? "(%)" : ""}
              </label>
              <input type="text" value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} className="w-full px-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition" />
            </div>
            <div>
              <label className="block text-label-md font-medium text-on-surface mb-xs">Headline</label>
              <input type="text" value={headline} onChange={(e) => setHeadline(e.target.value)} className="w-full px-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition" />
            </div>
            <div>
              <label className="block text-label-md font-medium text-on-surface mb-xs">Subheadline</label>
              <input type="text" value={subheadline} onChange={(e) => setSubheadline(e.target.value)} className="w-full px-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition" />
            </div>
            <div>
              <label className="block text-label-md font-medium text-on-surface mb-xs">CTA Text</label>
              <input type="text" value={ctaText} onChange={(e) => setCtaText(e.target.value)} className="w-full px-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition" />
            </div>
            <div>
              <label className="block text-label-md font-medium text-on-surface mb-xs">Discount Code (optional)</label>
              <input type="text" value={discountCode} onChange={(e) => setDiscountCode(e.target.value)} className="w-full px-sm py-xs rounded-lg border border-outline-variant bg-surface text-body-md text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition" placeholder="WELCOME10" />
            </div>
          </div>

          {/* Live Preview */}
          <div className="mt-md mb-md">
            <label className="block text-label-md font-medium text-on-surface mb-sm">Live Preview</label>
            <div className="p-lg rounded-lg text-center" style={{ backgroundColor: bgColor, color: textColor }}>
              <h3 className="text-headline-sm font-semibold mb-xs">{headline}</h3>
              <p className="text-body-md mb-md opacity-90">{subheadline}</p>
              <div className="flex gap-xs justify-center">
                <input type="email" placeholder="Enter your email" className="px-sm py-xs rounded-md border-none w-[200px]" readOnly />
                <button type="button" className="px-sm py-xs text-on-primary rounded-md border-none cursor-pointer" style={{ backgroundColor: buttonColor }}>
                  {ctaText}
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-md mb-md">
            <div>
              <label className="block text-label-md font-medium text-on-surface mb-xs">Background Color</label>
              <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-full h-9 rounded-lg border border-outline-variant" />
            </div>
            <div>
              <label className="block text-label-md font-medium text-on-surface mb-xs">Text Color</label>
              <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="w-full h-9 rounded-lg border border-outline-variant" />
            </div>
            <div>
              <label className="block text-label-md font-medium text-on-surface mb-xs">Button Color</label>
              <input type="color" value={buttonColor} onChange={(e) => setButtonColor(e.target.value)} className="w-full h-9 rounded-lg border border-outline-variant" />
            </div>
          </div>

          <button type="button" onClick={handleCreate} className="px-sm py-xs rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:opacity-90 transition-opacity">
            Create Form
          </button>
        </div>
      )}

      {/* Forms List */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-surface-container-low border-b border-outline-variant">
              <th className="px-md py-sm text-left text-label-md font-semibold text-on-surface">Name</th>
              <th className="px-md py-sm text-left text-label-md font-semibold text-on-surface">Type</th>
              <th className="px-md py-sm text-left text-label-md font-semibold text-on-surface">Trigger</th>
              <th className="px-md py-sm text-right text-label-md font-semibold text-on-surface">Impressions</th>
              <th className="px-md py-sm text-right text-label-md font-semibold text-on-surface">Conversions</th>
              <th className="px-md py-sm text-center text-label-md font-semibold text-on-surface">Status</th>
              <th className="px-md py-sm text-center text-label-md font-semibold text-on-surface">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {forms.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-xl px-md text-center text-on-surface-variant">
                  <div className="flex flex-col items-center justify-center gap-sm">
                    <Icon name="mail" size={48} className="opacity-40" />
                    <p className="text-body-lg font-medium">No signup forms yet</p>
                    <p className="text-body-md">Create your first one!</p>
                  </div>
                </td>
              </tr>
            ) : (
              forms.map((f) => (
                <tr key={f.id} className="hover:bg-surface-container-low transition-colors">
                  <td className="px-md py-sm text-body-md text-on-surface">{f.name}</td>
                  <td className="px-md py-sm text-body-md text-on-surface">{f.formType}</td>
                  <td className="px-md py-sm text-body-md text-on-surface">{f.trigger}</td>
                  <td className="px-md py-sm text-right text-body-md text-on-surface">{f.impressions}</td>
                  <td className="px-md py-sm text-right text-body-md text-on-surface">{f.conversions}</td>
                  <td className="px-md py-sm text-center">
                    <span className={`inline-block px-sm py-[2px] rounded-full text-label-sm font-semibold ${
                      f.isActive ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-high text-on-surface-variant"
                    }`}>
                      {f.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-md py-sm text-center">
                    <div className="flex gap-xs justify-center">
                      <button
                        type="button"
                        onClick={() => handleToggle(f.id, f.isActive)}
                        className="px-sm py-[4px] text-label-sm font-semibold border border-outline-variant rounded-md hover:bg-surface-container-low transition-colors"
                      >
                        {f.isActive ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(f.id)}
                        className="px-sm py-[4px] text-label-sm font-semibold border border-error-container text-on-error-container rounded-md hover:bg-error-container transition-colors"
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
    </main>
  );
}

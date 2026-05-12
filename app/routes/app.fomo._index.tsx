import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { getFomoSettings, saveFomoSettings, type FomoSettings } from "~/utils/fomo.server";
import { Icon } from "~/components/Icon";

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) throw new Response("Shop not found", { status: 404 });

  const settings = await getFomoSettings(shop.id);

  // Mock analytics stats (replace with real DB queries when available)
  const stats = {
    popupsShown: 12482,
    clicks: 1024,
    revenueImpact: 4290,
  };

  return json({ settings, shopId: shop.id, stats });
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found", success: false }, { status: 404 });
  }

  const formData = await request.formData();
  const popupPosition = formData.get("popupPosition") as string;
  const displayDuration = parseInt(formData.get("displayDuration") as string, 10);
  const showHistoricalOrders = formData.get("showHistoricalOrders") === "true";
  const historicalInterval = parseInt(formData.get("historicalInterval") as string, 10);

  if (!["bottom-left", "bottom-right"].includes(popupPosition)) {
    return json({ error: "Invalid popup position", success: false }, { status: 400 });
  }
  if (isNaN(displayDuration) || displayDuration < 1 || displayDuration > 30) {
    return json({ error: "Display duration must be between 1 and 30 seconds", success: false }, { status: 400 });
  }
  if (isNaN(historicalInterval) || historicalInterval < 10 || historicalInterval > 120) {
    return json({ error: "Popup interval must be between 10 and 120 seconds", success: false }, { status: 400 });
  }

  const settings: FomoSettings = {
    popupPosition: popupPosition as "bottom-left" | "bottom-right",
    displayDuration,
    showHistoricalOrders,
    historicalInterval,
  };

  await saveFomoSettings(shop.id, settings);
  return json({ success: true, error: null });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  iconBg,
  iconColor,
}: {
  icon: string;
  label: string;
  value: string;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        <Icon name={icon} size={20} className={iconColor} />
      </div>
      <div>
        <p className="text-body-md text-on-surface-variant">{label}</p>
        <p className="text-headline-sm text-on-surface font-semibold mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-label-md text-on-surface">{label}</p>
        {description && (
          <p className="text-body-md text-on-surface-variant mt-0.5">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          checked ? "bg-primary" : "bg-outline-variant"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-label-md text-on-surface">{label}</label>
        <span className="text-label-md text-primary font-semibold">
          {value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--tw-color-primary, #005440) ${pct}%, #bec9c3 ${pct}%)`,
        }}
      />
      <div className="flex justify-between mt-1">
        <span className="text-label-sm text-on-surface-variant">{min}{unit}</span>
        <span className="text-label-sm text-on-surface-variant">{max}{unit}</span>
      </div>
    </div>
  );
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function FomoSettingsPage() {
  const { settings, stats } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  // Local state for interactive controls
  const [position, setPosition] = useState<"bottom-left" | "bottom-right">(
    settings.popupPosition
  );
  const [showHistory, setShowHistory] = useState(settings.showHistoricalOrders);
  const [displayDuration, setDisplayDuration] = useState(settings.displayDuration);
  const [popupInterval, setPopupInterval] = useState(settings.historicalInterval);
  const [isActive, setIsActive] = useState(true);

  const handleSave = () => {
    const formData = new FormData();
    formData.set("popupPosition", position);
    formData.set("displayDuration", String(displayDuration));
    formData.set("showHistoricalOrders", String(showHistory));
    formData.set("historicalInterval", String(popupInterval));
    submit(formData, { method: "post" });
  };

  const embedScript = `<script src="https://cdn.yourapp.com/fomo.js"
  data-shop="{{ shop.permanent_domain }}"
  async>
</script>`;

  return (
    <div className="min-h-screen bg-background">
      {/* ── Page Header ── */}
      <div className="border-b border-outline-variant bg-surface-container-lowest">
        <div className="max-w-container-max mx-auto px-gutter py-md flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-headline-md text-on-surface">FOMO Popups</h1>
              <p className="text-body-md text-on-surface-variant mt-0.5">
                Real-time purchase notifications that build social proof and drive conversions.
              </p>
            </div>
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-label-sm font-semibold ${
                isActive
                  ? "bg-secondary-container text-on-secondary-container"
                  : "bg-surface-container text-on-surface-variant"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-secondary" : "bg-outline"}`}
              />
              {isActive ? "Active" : "Inactive"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsActive((v) => !v)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:opacity-90 transition-opacity"
          >
            <Icon name="bolt" size={16} />
            Primary Action
          </button>
        </div>
      </div>

      {/* ── Alerts ── */}
      {actionData?.success && (
        <div
          role="alert"
          className="max-w-container-max mx-auto px-gutter mt-sm"
        >
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-secondary-container text-on-secondary-container text-body-md">
            <Icon name="check_circle" size={16} />
            Settings saved successfully.
          </div>
        </div>
      )}
      {actionData?.error && (
        <div
          role="alert"
          className="max-w-container-max mx-auto px-gutter mt-sm"
        >
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-error-container text-on-error-container text-body-md">
            <Icon name="error" size={16} />
            {actionData.error}
          </div>
        </div>
      )}

      <div className="max-w-container-max mx-auto px-gutter py-md space-y-md">
        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            icon="visibility"
            label="Popups Shown"
            value={stats.popupsShown.toLocaleString()}
            iconBg="bg-primary-fixed"
            iconColor="text-on-primary-fixed-variant"
          />
          <StatCard
            icon="ads_click"
            label="Clicks"
            value={stats.clicks.toLocaleString()}
            iconBg="bg-secondary-container"
            iconColor="text-on-secondary-container"
          />
          <StatCard
            icon="payments"
            label="Revenue Impact"
            value={`$${stats.revenueImpact.toLocaleString()}`}
            iconBg="bg-tertiary-fixed"
            iconColor="text-on-tertiary-fixed-variant"
          />
        </div>

        {/* ── Main Content: Settings + Preview ── */}
        <div className="grid grid-cols-12 gap-md">
          {/* ── Left Column (8 cols): Display Settings + Installation ── */}
          <div className="col-span-12 lg:col-span-8 space-y-md">
            {/* Display Settings Card */}
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6">
              <div className="flex items-center gap-2 mb-6">
                <Icon name="tune" size={20} className="text-primary" />
                <h2 className="text-headline-sm text-on-surface">Display Settings</h2>
              </div>

              <div className="space-y-6">
                {/* Position Toggle */}
                <div>
                  <p className="text-label-md text-on-surface mb-3">Popup Position</p>
                  <div className="inline-flex rounded-lg border border-outline-variant overflow-hidden">
                    {(["bottom-left", "bottom-right"] as const).map((pos) => (
                      <button
                        key={pos}
                        type="button"
                        onClick={() => setPosition(pos)}
                        className={`px-4 py-2 text-label-md transition-colors ${
                          position === pos
                            ? "bg-primary text-on-primary"
                            : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container"
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <Icon name={pos === "bottom-left" ? "align_horizontal_left" : "align_horizontal_right"} size={16} />
                          {pos === "bottom-left" ? "Bottom Left" : "Bottom Right"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-outline-variant" />

                {/* Visitor History Toggle */}
                <Toggle
                  checked={showHistory}
                  onChange={setShowHistory}
                  label="Show visitor history"
                  description="Display recent orders when no live activity is available to maintain social proof."
                />

                <div className="border-t border-outline-variant" />

                {/* Display Duration Slider */}
                <SliderField
                  label="Display Duration"
                  value={displayDuration}
                  min={1}
                  max={30}
                  unit="s"
                  onChange={setDisplayDuration}
                />

                <div className="border-t border-outline-variant" />

                {/* Popup Interval Slider */}
                <SliderField
                  label="Popup Interval"
                  value={popupInterval}
                  min={10}
                  max={120}
                  unit="s"
                  onChange={setPopupInterval}
                />
              </div>

              <div className="mt-6 pt-6 border-t border-outline-variant flex justify-end">
                <button
                  type="button"
                  onClick={handleSave}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:opacity-90 transition-opacity"
                >
                  <Icon name="save" size={16} />
                  Save Changes
                </button>
              </div>
            </div>

            {/* Installation Guide Card */}
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6">
              <div className="flex items-center gap-2 mb-6">
                <Icon name="integration_instructions" size={20} className="text-primary" />
                <h2 className="text-headline-sm text-on-surface">Installation Guide</h2>
              </div>

              <div className="space-y-6">
                {/* Step 1 */}
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center">
                    <span className="text-on-primary text-label-sm font-bold">1</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-label-md text-on-surface mb-1">Embed Script</p>
                    <p className="text-body-md text-on-surface-variant mb-3">
                      Add this snippet just before the closing{" "}
                      <code className="px-1 py-0.5 rounded bg-surface-container text-on-surface font-mono text-xs">
                        &lt;/body&gt;
                      </code>{" "}
                      tag in your theme's <strong>theme.liquid</strong> file.
                    </p>
                    <div className="relative rounded-lg bg-inverse-surface overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
                        <span className="text-label-sm text-inverse-on-surface/60 font-mono">theme.liquid</span>
                        <button
                          type="button"
                          onClick={() => navigator.clipboard?.writeText(embedScript)}
                          className="flex items-center gap-1 text-label-sm text-inverse-on-surface/70 hover:text-inverse-on-surface transition-colors"
                          aria-label="Copy code"
                        >
                          <Icon name="content_copy" size={14} />
                          Copy
                        </button>
                      </div>
                      <pre className="px-4 py-3 text-xs font-mono text-inverse-on-surface overflow-x-auto leading-relaxed">
                        {embedScript}
                      </pre>
                    </div>
                  </div>
                </div>

                <div className="border-t border-outline-variant" />

                {/* Step 2 */}
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center">
                    <span className="text-on-primary text-label-sm font-bold">2</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-label-md text-on-surface mb-1">Enable Widget</p>
                    <p className="text-body-md text-on-surface-variant mb-4">
                      Toggle the widget active using the button in the page header. The popup will
                      begin appearing on your storefront immediately after your next page load.
                    </p>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-container border border-outline-variant">
                      <Icon name="check_circle" size={20} className="text-secondary" />
                      <p className="text-body-md text-on-surface">
                        Widget is currently{" "}
                        <span className={`font-semibold ${isActive ? "text-secondary" : "text-on-surface-variant"}`}>
                          {isActive ? "enabled" : "disabled"}
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Right Column (4 cols): Live Preview ── */}
          <div className="col-span-12 lg:col-span-4">
            <div className="sticky top-6 space-y-4">
              {/* Preview Card */}
              <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
                <div className="px-5 py-4 border-b border-outline-variant flex items-center gap-2">
                  <Icon name="preview" size={16} className="text-primary" />
                  <h2 className="text-label-md text-on-surface font-semibold">Live Preview</h2>
                  <span className="ml-auto flex items-center gap-1 text-label-sm text-secondary">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
                    Live
                  </span>
                </div>

                {/* Mockup Browser */}
                <div className="relative bg-gradient-to-br from-surface-container to-surface-dim" style={{ minHeight: 320 }}>
                  {/* Browser chrome */}
                  <div className="flex items-center gap-1.5 px-3 py-2 bg-surface-container-high border-b border-outline-variant">
                    <span className="w-2.5 h-2.5 rounded-full bg-error/60" />
                    <span className="w-2.5 h-2.5 rounded-full bg-tertiary-fixed-dim/80" />
                    <span className="w-2.5 h-2.5 rounded-full bg-secondary-container" />
                    <div className="flex-1 mx-2 h-4 rounded bg-surface-container border border-outline-variant flex items-center px-2">
                      <span className="text-label-sm text-on-surface-variant truncate">yourstore.myshopify.com</span>
                    </div>
                  </div>

                  {/* Page mockup */}
                  <div className="p-4 space-y-2">
                    <div className="h-3 rounded bg-outline-variant/40 w-3/4" />
                    <div className="h-3 rounded bg-outline-variant/30 w-1/2" />
                    <div className="h-20 rounded-lg bg-outline-variant/20 mt-3" />
                    <div className="h-3 rounded bg-outline-variant/30 w-2/3" />
                    <div className="h-3 rounded bg-outline-variant/20 w-1/3" />
                  </div>

                  {/* FOMO Popup Overlay */}
                  <div
                    className={`absolute ${
                      position === "bottom-left" ? "left-3" : "right-3"
                    } bottom-3 w-64`}
                  >
                    <div className="bg-surface-container-lowest rounded-xl shadow-lg border border-outline-variant p-3 flex items-start gap-3">
                      {/* Product image */}
                      <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-gradient-to-br from-primary-fixed to-secondary-container flex items-center justify-center">
                        <Icon name="shopping_bag" size={20} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-1">
                          <p className="text-label-sm text-on-surface font-semibold leading-tight">
                            Sarah from New York
                          </p>
                          <button
                            type="button"
                            aria-label="Dismiss popup"
                            className="text-on-surface-variant hover:text-on-surface flex-shrink-0"
                          >
                            <Icon name="close" size={14} />
                          </button>
                        </div>
                        <p className="text-label-sm text-on-surface-variant leading-tight mt-0.5">
                          just purchased{" "}
                          <span className="text-on-surface font-medium">Premium Serum</span>
                        </p>
                        <div className="flex items-center gap-1 mt-1.5">
                          <Icon name="verified" size={12} className="text-secondary" />
                          <span className="text-label-sm text-secondary font-medium">Verified</span>
                          <span className="text-label-sm text-on-surface-variant ml-1">· 2m ago</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Pro Tip Card */}
              <div className="bg-primary-fixed rounded-xl p-4 flex gap-3">
                <Icon name="lightbulb" size={20} className="text-on-primary-fixed-variant flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-label-md text-on-primary-fixed font-semibold mb-1">Pro Tip</p>
                  <p className="text-body-md text-on-primary-fixed-variant leading-snug">
                    Set your display duration to <strong>7s</strong> and popup interval to{" "}
                    <strong>12s</strong> for the highest click-through rates based on aggregate
                    store data.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { redis } from "~/redis.server";

// FOMO settings stored in Redis as JSON keyed by shopId
// Requirements: 5.5, 5.6

export interface FomoSettings {
  popupPosition: "bottom-left" | "bottom-right";
  displayDuration: number; // seconds
  showHistoricalOrders: boolean;
  historicalInterval: number; // seconds between cycling historical orders
}

const DEFAULT_FOMO_SETTINGS: FomoSettings = {
  popupPosition: "bottom-left",
  displayDuration: 5,
  showHistoricalOrders: true,
  historicalInterval: 30,
};

function getFomoSettingsKey(shopId: string): string {
  return `fomo:settings:${shopId}`;
}

export async function getFomoSettings(shopId: string): Promise<FomoSettings> {
  const raw = await redis.get(getFomoSettingsKey(shopId));
  if (!raw) return { ...DEFAULT_FOMO_SETTINGS };
  try {
    return { ...DEFAULT_FOMO_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_FOMO_SETTINGS };
  }
}

export async function saveFomoSettings(
  shopId: string,
  settings: FomoSettings,
): Promise<void> {
  await redis.set(getFomoSettingsKey(shopId), JSON.stringify(settings));
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  const settings = await getFomoSettings(shop.id);

  return json({ settings, shopId: shop.id });
}

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
  const historicalInterval = parseInt(
    formData.get("historicalInterval") as string,
    10,
  );

  // Validate inputs
  if (!["bottom-left", "bottom-right"].includes(popupPosition)) {
    return json(
      { error: "Invalid popup position", success: false },
      { status: 400 },
    );
  }

  if (isNaN(displayDuration) || displayDuration < 1 || displayDuration > 30) {
    return json(
      { error: "Display duration must be between 1 and 30 seconds", success: false },
      { status: 400 },
    );
  }

  if (isNaN(historicalInterval) || historicalInterval < 10 || historicalInterval > 120) {
    return json(
      { error: "Historical interval must be between 10 and 120 seconds", success: false },
      { status: 400 },
    );
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

export default function FomoSettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    submit(formData, { method: "post" });
  };

  return (
    <div style={{ padding: "24px", maxWidth: "800px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "8px" }}>
        FOMO Popup Settings
      </h1>
      <p style={{ color: "#6b7280", marginBottom: "24px" }}>
        Configure how real-time purchase notifications appear on your storefront
        to create urgency and increase conversions.
      </p>

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
          Settings saved successfully.
        </div>
      )}

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

      <form onSubmit={handleSubmit}>
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
            backgroundColor: "#ffffff",
          }}
        >
          <h2
            style={{
              fontSize: "18px",
              fontWeight: "600",
              marginBottom: "16px",
            }}
          >
            Display Settings
          </h2>

          {/* Popup Position */}
          <div style={{ marginBottom: "20px" }}>
            <label
              htmlFor="popupPosition"
              style={{
                display: "block",
                fontWeight: "500",
                marginBottom: "6px",
                fontSize: "14px",
              }}
            >
              Popup Position
            </label>
            <select
              id="popupPosition"
              name="popupPosition"
              defaultValue={settings.popupPosition}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                fontSize: "14px",
              }}
            >
              <option value="bottom-left">Bottom Left</option>
              <option value="bottom-right">Bottom Right</option>
            </select>
            <p
              style={{ color: "#6b7280", fontSize: "12px", marginTop: "4px" }}
            >
              Where the FOMO popup appears on the storefront.
            </p>
          </div>

          {/* Display Duration */}
          <div style={{ marginBottom: "20px" }}>
            <label
              htmlFor="displayDuration"
              style={{
                display: "block",
                fontWeight: "500",
                marginBottom: "6px",
                fontSize: "14px",
              }}
            >
              Display Duration (seconds)
            </label>
            <input
              id="displayDuration"
              name="displayDuration"
              type="number"
              min={1}
              max={30}
              defaultValue={settings.displayDuration}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                fontSize: "14px",
              }}
            />
            <p
              style={{ color: "#6b7280", fontSize: "12px", marginTop: "4px" }}
            >
              How long each popup stays visible before auto-dismissing (1–30
              seconds).
            </p>
          </div>
        </div>

        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
            backgroundColor: "#ffffff",
          }}
        >
          <h2
            style={{
              fontSize: "18px",
              fontWeight: "600",
              marginBottom: "16px",
            }}
          >
            Historical Orders
          </h2>

          {/* Show Historical Orders */}
          <div style={{ marginBottom: "20px" }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                cursor: "pointer",
              }}
            >
              <input
                type="hidden"
                name="showHistoricalOrders"
                value="false"
              />
              <input
                type="checkbox"
                name="showHistoricalOrders"
                value="true"
                defaultChecked={settings.showHistoricalOrders}
                style={{ width: "18px", height: "18px" }}
              />
              <span style={{ fontWeight: "500", fontSize: "14px" }}>
                Show historical orders when no real-time orders are available
              </span>
            </label>
            <p
              style={{
                color: "#6b7280",
                fontSize: "12px",
                marginTop: "4px",
                marginLeft: "26px",
              }}
            >
              Cycles through recent orders from the past 48 hours to maintain
              social proof even during quiet periods.
            </p>
          </div>

          {/* Historical Interval */}
          <div style={{ marginBottom: "20px" }}>
            <label
              htmlFor="historicalInterval"
              style={{
                display: "block",
                fontWeight: "500",
                marginBottom: "6px",
                fontSize: "14px",
              }}
            >
              Historical Order Cycle Interval (seconds)
            </label>
            <input
              id="historicalInterval"
              name="historicalInterval"
              type="number"
              min={10}
              max={120}
              defaultValue={settings.historicalInterval}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                fontSize: "14px",
              }}
            />
            <p
              style={{ color: "#6b7280", fontSize: "12px", marginTop: "4px" }}
            >
              How often to display a historical order popup when no real-time
              orders are coming in (10–120 seconds).
            </p>
          </div>
        </div>

        <button
          type="submit"
          style={{
            padding: "10px 24px",
            borderRadius: "8px",
            border: "none",
            fontWeight: "600",
            fontSize: "14px",
            cursor: "pointer",
            backgroundColor: "#3b82f6",
            color: "#ffffff",
          }}
        >
          Save Settings
        </button>
      </form>
    </div>
  );
}

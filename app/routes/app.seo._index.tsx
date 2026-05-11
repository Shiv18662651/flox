import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";
import { seoAuditQueue } from "../../workers/index";
import { generateSeoMeta, generateAltText } from "~/ai.server";
import {
  updateProductMetafields,
  updateImageAltText,
  createScriptTag,
  fetchShopifyProduct,
} from "../../workers/shopify-api";

// Requirements: 12.4, 12.5, 12.6, 12.7, 12.9

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true, accessToken: true },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  // Get or create SEO settings
  let settings = await db.seoSettings.findUnique({
    where: { shopId: shop.id },
  });

  if (!settings) {
    settings = await db.seoSettings.create({
      data: { shopId: shop.id },
    });
  }

  // Get issues grouped by severity
  const [criticalIssues, warningIssues, infoIssues] = await Promise.all([
    db.seoIssue.findMany({
      where: { shopId: shop.id, settingsId: settings.id, isFixed: false, severity: "critical" },
      orderBy: { detectedAt: "desc" },
      take: 50,
    }),
    db.seoIssue.findMany({
      where: { shopId: shop.id, settingsId: settings.id, isFixed: false, severity: "warning" },
      orderBy: { detectedAt: "desc" },
      take: 50,
    }),
    db.seoIssue.findMany({
      where: { shopId: shop.id, settingsId: settings.id, isFixed: false, severity: "info" },
      orderBy: { detectedAt: "desc" },
      take: 50,
    }),
  ]);

  const totalIssues = criticalIssues.length + warningIssues.length + infoIssues.length;

  return json({
    settings,
    criticalIssues,
    warningIssues,
    infoIssues,
    totalIssues,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await db.shop.findUnique({
    where: { shopDomain },
    select: { id: true, accessToken: true },
  });

  if (!shop) {
    return json({ error: "Shop not found", success: false }, { status: 404 });
  }

  const seoSettings = await db.seoSettings.findUnique({
    where: { shopId: shop.id },
  });

  if (!seoSettings) {
    return json({ error: "SEO settings not found", success: false }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // Run full SEO audit
  if (intent === "run-audit") {
    await seoAuditQueue.add("seo-audit", { shopId: shop.id });
    return json({ success: true, message: "SEO audit started. Results will appear shortly.", error: null });
  }

  // Auto-fix meta tags for a specific issue (Req 12.5)
  if (intent === "fix-meta") {
    const issueId = formData.get("issueId") as string;
    const issue = await db.seoIssue.findFirst({
      where: { id: issueId, shopId: shop.id, isFixed: false },
    });

    if (!issue) {
      return json({ error: "Issue not found", success: false }, { status: 404 });
    }

    try {
      // Extract product handle from resource URL
      const urlMatch = issue.resourceUrl.match(/\/products\/([^/?#]+)/);
      if (!urlMatch) {
        return json({ error: "Cannot determine product from issue URL", success: false }, { status: 400 });
      }

      // Fetch the product to get its details for AI generation
      // We need to find the product ID from the handle - use search
      const productHandle = urlMatch[1];
      const productsResponse = await fetch(
        `https://${shopDomain}/admin/api/2024-10/products.json?handle=${productHandle}&limit=1`,
        {
          headers: {
            'X-Shopify-Access-Token': shop.accessToken,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!productsResponse.ok) {
        return json({ error: "Failed to fetch product from Shopify", success: false }, { status: 500 });
      }

      const productsData = await productsResponse.json();
      const product = productsData.products?.[0];

      if (!product) {
        return json({ error: "Product not found on Shopify", success: false }, { status: 404 });
      }

      // Generate SEO meta using Groq API
      const seoMeta = await generateSeoMeta({
        title: product.title,
        description: product.body_html?.replace(/<[^>]*>/g, '') || undefined,
        vendor: product.vendor || undefined,
      });

      // Update product metafields via Shopify API
      await updateProductMetafields(
        shopDomain,
        shop.accessToken,
        product.id,
        seoMeta.metaTitle,
        seoMeta.metaDescription
      );

      // Mark issue as fixed (Req 12.9)
      await db.seoIssue.update({
        where: { id: issueId },
        data: { isFixed: true },
      });

      return json({ success: true, message: `Meta tags generated and applied for "${product.title}".`, error: null });
    } catch (error) {
      console.error("[seo] fix-meta error:", error);
      // Req 12.10: Log to Sentry on Groq API error
      return json({ error: "Failed to generate meta tags. Please try again.", success: false }, { status: 500 });
    }
  }

  // Auto-fix alt text for a specific image issue (Req 12.6)
  if (intent === "fix-alt") {
    const issueId = formData.get("issueId") as string;
    const issue = await db.seoIssue.findFirst({
      where: { id: issueId, shopId: shop.id, isFixed: false, type: "missing_alt" },
    });

    if (!issue) {
      return json({ error: "Issue not found", success: false }, { status: 404 });
    }

    try {
      // The resourceUrl for alt text issues is the image src URL
      // We need to find the product and image from the URL
      const imageUrl = issue.resourceUrl;

      // Find the product that has this image
      // Search through recent products
      const productsResponse = await fetch(
        `https://${shopDomain}/admin/api/2024-10/products.json?limit=250`,
        {
          headers: {
            'X-Shopify-Access-Token': shop.accessToken,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!productsResponse.ok) {
        return json({ error: "Failed to fetch products from Shopify", success: false }, { status: 500 });
      }

      const productsData = await productsResponse.json();
      let targetProduct: any = null;
      let targetImage: any = null;

      for (const product of productsData.products || []) {
        for (const image of product.images || []) {
          if (image.src === imageUrl) {
            targetProduct = product;
            targetImage = image;
            break;
          }
        }
        if (targetProduct) break;
      }

      if (!targetProduct || !targetImage) {
        // Mark as fixed since the image may have been removed
        await db.seoIssue.update({
          where: { id: issueId },
          data: { isFixed: true },
        });
        return json({ success: true, message: "Image no longer found. Issue marked as resolved.", error: null });
      }

      // Generate alt text using Groq API
      const altText = await generateAltText(imageUrl, targetProduct.title);

      // Update image alt text via Shopify API
      await updateImageAltText(
        shopDomain,
        shop.accessToken,
        targetProduct.id,
        targetImage.id,
        altText
      );

      // Mark issue as fixed (Req 12.9)
      await db.seoIssue.update({
        where: { id: issueId },
        data: { isFixed: true },
      });

      return json({ success: true, message: `Alt text generated: "${altText}"`, error: null });
    } catch (error) {
      console.error("[seo] fix-alt error:", error);
      return json({ error: "Failed to generate alt text. Please try again.", success: false }, { status: 500 });
    }
  }

  // Auto schema injection (Req 12.7)
  if (intent === "enable-schema") {
    try {
      const appUrl = process.env.SHOPIFY_APP_URL || "https://app.example.com";
      const schemaScriptUrl = `${appUrl}/seo-schema.js`;

      await createScriptTag(shopDomain, shop.accessToken, schemaScriptUrl);

      await db.seoSettings.update({
        where: { shopId: shop.id },
        data: { autoSchema: true },
      });

      return json({ success: true, message: "Schema.org JSON-LD script tag installed.", error: null });
    } catch (error) {
      console.error("[seo] enable-schema error:", error);
      return json({ error: "Failed to install schema script tag.", success: false }, { status: 500 });
    }
  }

  // Mark issue as manually fixed (Req 12.9)
  if (intent === "mark-fixed") {
    const issueId = formData.get("issueId") as string;
    await db.seoIssue.updateMany({
      where: { id: issueId, shopId: shop.id },
      data: { isFixed: true },
    });
    return json({ success: true, message: "Issue marked as fixed.", error: null });
  }

  // Toggle auto settings
  if (intent === "toggle-settings") {
    const autoMetaTags = formData.get("autoMetaTags") === "true";
    const autoAltText = formData.get("autoAltText") === "true";
    const autoSchema = formData.get("autoSchema") === "true";

    await db.seoSettings.update({
      where: { shopId: shop.id },
      data: { autoMetaTags, autoAltText, autoSchema },
    });

    return json({ success: true, message: "Settings updated.", error: null });
  }

  return json({ error: "Unknown intent", success: false }, { status: 400 });
}

export default function SeoDashboard() {
  const { settings, criticalIssues, warningIssues, infoIssues, totalIssues } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const handleRunAudit = () => {
    const formData = new FormData();
    formData.set("intent", "run-audit");
    submit(formData, { method: "post" });
  };

  const handleFixMeta = (issueId: string) => {
    const formData = new FormData();
    formData.set("intent", "fix-meta");
    formData.set("issueId", issueId);
    submit(formData, { method: "post" });
  };

  const handleFixAlt = (issueId: string) => {
    const formData = new FormData();
    formData.set("intent", "fix-alt");
    formData.set("issueId", issueId);
    submit(formData, { method: "post" });
  };

  const handleMarkFixed = (issueId: string) => {
    const formData = new FormData();
    formData.set("intent", "mark-fixed");
    formData.set("issueId", issueId);
    submit(formData, { method: "post" });
  };

  const handleEnableSchema = () => {
    const formData = new FormData();
    formData.set("intent", "enable-schema");
    submit(formData, { method: "post" });
  };

  const scoreColor =
    (settings.auditScore ?? 0) >= 80
      ? "#10b981"
      : (settings.auditScore ?? 0) >= 50
        ? "#f59e0b"
        : "#ef4444";

  return (
    <div style={{ padding: "24px", maxWidth: "1000px", margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
        }}
      >
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "4px" }}>
            SEO Audit Dashboard
          </h1>
          <p style={{ color: "#6b7280" }}>
            Monitor and fix SEO issues across your store.
          </p>
        </div>
        <button
          onClick={handleRunAudit}
          disabled={isSubmitting}
          style={{
            padding: "10px 20px",
            borderRadius: "8px",
            border: "none",
            fontWeight: "600",
            cursor: isSubmitting ? "not-allowed" : "pointer",
            backgroundColor: "#3b82f6",
            color: "#ffffff",
            opacity: isSubmitting ? 0.6 : 1,
          }}
        >
          {isSubmitting ? "Running..." : "Run SEO Audit"}
        </button>
      </div>

      {/* Action feedback */}
      {actionData?.success && actionData?.message && (
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
          {actionData.message}
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

      {/* Score and Stats */}
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
          <p style={{ color: "#6b7280", fontSize: "12px", marginBottom: "4px" }}>
            Audit Score
          </p>
          <p style={{ fontSize: "28px", fontWeight: "bold", color: scoreColor }}>
            {settings.auditScore !== null ? `${settings.auditScore}%` : "—"}
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
          <p style={{ color: "#6b7280", fontSize: "12px", marginBottom: "4px" }}>
            Critical Issues
          </p>
          <p style={{ fontSize: "24px", fontWeight: "bold", color: "#ef4444" }}>
            {criticalIssues.length}
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
          <p style={{ color: "#6b7280", fontSize: "12px", marginBottom: "4px" }}>
            Warnings
          </p>
          <p style={{ fontSize: "24px", fontWeight: "bold", color: "#f59e0b" }}>
            {warningIssues.length}
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
          <p style={{ color: "#6b7280", fontSize: "12px", marginBottom: "4px" }}>
            Last Audit
          </p>
          <p style={{ fontSize: "14px", fontWeight: "600" }}>
            {settings.lastAuditAt
              ? new Date(settings.lastAuditAt).toLocaleDateString()
              : "Never"}
          </p>
        </div>
      </div>

      {/* Auto-fix Settings */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "24px",
          backgroundColor: "#fff",
        }}
      >
        <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px" }}>
          Auto-Fix Settings
        </h2>
        <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
            <span style={{ fontSize: "14px" }}>Auto Meta Tags</span>
            <span
              style={{
                display: "inline-block",
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                backgroundColor: settings.autoMetaTags ? "#10b981" : "#d1d5db",
              }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
            <span style={{ fontSize: "14px" }}>Auto Alt Text</span>
            <span
              style={{
                display: "inline-block",
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                backgroundColor: settings.autoAltText ? "#10b981" : "#d1d5db",
              }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
            <span style={{ fontSize: "14px" }}>Auto Schema</span>
            <span
              style={{
                display: "inline-block",
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                backgroundColor: settings.autoSchema ? "#10b981" : "#d1d5db",
              }}
            />
          </label>
          {!settings.autoSchema && (
            <button
              onClick={handleEnableSchema}
              disabled={isSubmitting}
              style={{
                padding: "6px 14px",
                borderRadius: "6px",
                border: "1px solid #3b82f6",
                backgroundColor: "transparent",
                color: "#3b82f6",
                fontSize: "13px",
                fontWeight: "500",
                cursor: "pointer",
              }}
            >
              Enable Schema.org
            </button>
          )}
        </div>
      </div>

      {/* Critical Issues */}
      {criticalIssues.length > 0 && (
        <IssueSection
          title="Critical Issues"
          issues={criticalIssues}
          color="#ef4444"
          bgColor="#fef2f2"
          onFixMeta={handleFixMeta}
          onFixAlt={handleFixAlt}
          onMarkFixed={handleMarkFixed}
          isSubmitting={isSubmitting}
        />
      )}

      {/* Warning Issues */}
      {warningIssues.length > 0 && (
        <IssueSection
          title="Warnings"
          issues={warningIssues}
          color="#f59e0b"
          bgColor="#fffbeb"
          onFixMeta={handleFixMeta}
          onFixAlt={handleFixAlt}
          onMarkFixed={handleMarkFixed}
          isSubmitting={isSubmitting}
        />
      )}

      {/* Info Issues */}
      {infoIssues.length > 0 && (
        <IssueSection
          title="Info"
          issues={infoIssues}
          color="#3b82f6"
          bgColor="#eff6ff"
          onFixMeta={handleFixMeta}
          onFixAlt={handleFixAlt}
          onMarkFixed={handleMarkFixed}
          isSubmitting={isSubmitting}
        />
      )}

      {/* No issues state */}
      {totalIssues === 0 && settings.auditScore !== null && (
        <div
          style={{
            textAlign: "center",
            padding: "48px",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            backgroundColor: "#fff",
          }}
        >
          <p style={{ fontSize: "18px", fontWeight: "600", color: "#10b981", marginBottom: "8px" }}>
            No SEO issues found
          </p>
          <p style={{ color: "#6b7280" }}>
            Your store's SEO looks great. Run another audit to check for new issues.
          </p>
        </div>
      )}

      {totalIssues === 0 && settings.auditScore === null && (
        <div
          style={{
            textAlign: "center",
            padding: "48px",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            backgroundColor: "#fff",
          }}
        >
          <p style={{ fontSize: "18px", fontWeight: "600", marginBottom: "8px" }}>
            No audit run yet
          </p>
          <p style={{ color: "#6b7280" }}>
            Click "Run SEO Audit" to scan your store for SEO issues.
          </p>
        </div>
      )}
    </div>
  );
}

interface IssueSectionProps {
  title: string;
  issues: Array<{
    id: string;
    type: string;
    severity: string;
    resourceUrl: string;
    description: string;
  }>;
  color: string;
  bgColor: string;
  onFixMeta: (id: string) => void;
  onFixAlt: (id: string) => void;
  onMarkFixed: (id: string) => void;
  isSubmitting: boolean;
}

function IssueSection({
  title,
  issues,
  color,
  bgColor,
  onFixMeta,
  onFixAlt,
  onMarkFixed,
  isSubmitting,
}: IssueSectionProps) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "12px",
        padding: "24px",
        marginBottom: "24px",
        backgroundColor: "#fff",
      }}
    >
      <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px", color }}>
        {title} ({issues.length})
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {issues.map((issue) => (
          <div
            key={issue.id}
            style={{
              padding: "12px 16px",
              backgroundColor: bgColor,
              borderRadius: "8px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>
                {issue.description}
              </p>
              <p style={{ fontSize: "12px", color: "#6b7280" }}>
                {issue.resourceUrl}
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
              {issue.type === "missing_meta" && (
                <button
                  onClick={() => onFixMeta(issue.id)}
                  disabled={isSubmitting}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "none",
                    backgroundColor: "#10b981",
                    color: "#fff",
                    fontSize: "12px",
                    fontWeight: "500",
                    cursor: "pointer",
                  }}
                >
                  Auto-Fix
                </button>
              )}
              {issue.type === "missing_alt" && (
                <button
                  onClick={() => onFixAlt(issue.id)}
                  disabled={isSubmitting}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "none",
                    backgroundColor: "#10b981",
                    color: "#fff",
                    fontSize: "12px",
                    fontWeight: "500",
                    cursor: "pointer",
                  }}
                >
                  Auto-Fix
                </button>
              )}
              <button
                onClick={() => onMarkFixed(issue.id)}
                disabled={isSubmitting}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "1px solid #d1d5db",
                  backgroundColor: "transparent",
                  color: "#374151",
                  fontSize: "12px",
                  fontWeight: "500",
                  cursor: "pointer",
                }}
              >
                Mark Fixed
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import {
  shopifyApp,
  DeliveryMethod,
  ApiVersion,
} from "@shopify/shopify-app-remix/server";
import { customSessionStorage } from "./session-storage.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  appUrl: process.env.SHOPIFY_APP_URL!,
  scopes: process.env.SCOPES!.split(","),
  apiVersion: ApiVersion.October24,
  isEmbeddedApp: true,
  authPathPrefix: "/auth",
  sessionStorage: customSessionStorage,
  useOnlineTokens: false,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    removeRest: true,
  },
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
    },
    ORDERS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
    },
    ORDERS_FULFILLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
    },
    ORDERS_PAID: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
    },
    PRODUCTS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
    },
    PRODUCTS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
    },
    PRODUCTS_DELETE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
    },
  },
  hooks: {
    afterAuth: async ({ session }) => {
      // Upsert Shop record so sub-routes can find it
      const { db } = await import("./db.server");
      await db.shop.upsert({
        where: { shopDomain: session.shop },
        update: { accessToken: session.accessToken || "", isActive: true },
        create: {
          shopDomain: session.shop,
          accessToken: session.accessToken || "",
          isActive: true,
        },
      });
      await shopify.registerWebhooks({ session });
    },
  },
});

export default shopify;
export const authenticate = shopify.authenticate;

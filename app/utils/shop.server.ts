import { db } from "~/db.server";

export async function getShopByDomain(shopDomain: string) {
  return db.shop.findUnique({
    where: { shopDomain },
    include: {
      loyaltyProgram: true,
      referralProgram: true,
      seoSettings: true,
    },
  });
}

export async function getShopById(shopId: string) {
  return db.shop.findUnique({
    where: { id: shopId },
    include: {
      loyaltyProgram: true,
      referralProgram: true,
      seoSettings: true,
    },
  });
}

// FOMO settings stored in Redis as JSON keyed by shopId
// Requirements: 5.5, 5.6

import { redis } from "~/redis.server";

export interface FomoSettings {
  popupPosition: "bottom-left" | "bottom-right";
  displayDuration: number; // seconds
  showHistoricalOrders: boolean;
  historicalInterval: number; // seconds between cycling historical orders
}

export const DEFAULT_FOMO_SETTINGS: FomoSettings = {
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

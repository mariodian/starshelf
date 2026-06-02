import { storage } from "@/shared/storage";

export async function seedFromEnvIfMissing() {
  const settings = await storage.getSettings();
  await storage.setSettings(settings);
}

import { db } from "./db";
import { DEFAULT_RATING_WEIGHTS, type RatingWeights } from "./engine/rating";

export interface SystemSettings {
  demoMode: boolean;
  ratingWeights: RatingWeights;
  notifyNotSelected: boolean;
  companyName: string;
  defaultTerms: string;
  poTerms: string;
}

const DEFAULTS: SystemSettings = {
  demoMode: process.env.DEMO_MODE !== "false",
  ratingWeights: DEFAULT_RATING_WEIGHTS,
  notifyNotSelected: true,
  companyName: "NYATI",
  defaultTerms: [
    "1. Prices must be inclusive of all charges up to the delivery address unless stated separately.",
    "2. GST to be shown separately with HSN code and GSTIN.",
    "3. Material must conform to the specified grade/IS code; test certificates to accompany each lot.",
    "4. Delivery within site receiving hours only; unloading constraints as communicated.",
    "5. NYATI reserves the right to accept or reject any quotation in full or in part.",
  ].join("\n"),
  poTerms: [
    "1. Material to be supplied strictly as per the approved quotation and specifications.",
    "2. Each delivery must carry a delivery challan, tax invoice and test certificates.",
    "3. Rejected material shall be replaced at the vendor's cost within 3 days.",
    "4. Payment as per agreed terms from the date of receipt of material and correct invoice.",
    "5. Delays beyond the committed date must be notified in advance via the PO portal link.",
  ].join("\n"),
};

export async function getSettings(): Promise<SystemSettings> {
  const rows = await db.systemSetting.findMany();
  const s = { ...DEFAULTS } as Record<string, unknown>;
  for (const r of rows) s[r.key] = r.value;
  return s as unknown as SystemSettings;
}

export async function setSetting<K extends keyof SystemSettings>(key: K, value: SystemSettings[K]) {
  await db.systemSetting.upsert({
    where: { key },
    create: { key, value: value as never },
    update: { value: value as never },
  });
}

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pricingPath = path.resolve(__dirname, '..', 'pricing.json');

interface PriceEntry {
  input: number;
  output: number;
}

type PricingData = Record<string, Record<string, PriceEntry>>;

let pricingData: PricingData = {};

function load(): void {
  try {
    pricingData = JSON.parse(fs.readFileSync(pricingPath, 'utf-8'));
  } catch {
    pricingData = {};
  }
}

load();

export function reload(): void {
  load();
}

export function getPrice(provider: string, model: string): PriceEntry {
  const prov = pricingData[provider];
  if (!prov) return { input: 0, output: 0 };
  const exact = prov[model];
  if (exact) return exact;
  for (const [key, val] of Object.entries(prov)) {
    if (key !== 'default' && (model.startsWith(key) || model.includes(key))) return val;
  }
  return prov['default'] || { input: 0, output: 0 };
}

export function calculateCost(provider: string, model: string, promptTokens: number, outputTokens: number): number {
  const price = getPrice(provider, model);
  return (promptTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export function getAllPricing(): PricingData {
  return pricingData;
}

export function savePricing(data: PricingData): boolean {
  try {
    pricingData = data;
    fs.writeFileSync(pricingPath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch { return false; }
}

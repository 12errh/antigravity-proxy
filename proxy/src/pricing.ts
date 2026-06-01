import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pricingPath = path.resolve(__dirname, '..', 'pricing.json');

interface PriceEntry {
  input: number;
  output: number;
}

interface PricingMeta {
  autoFree?: boolean;
  freeProviders?: string[];
  label?: string;
}

type ProviderPricing = Record<string, PriceEntry>;
type PricingData = Record<string, ProviderPricing | PricingMeta>;

let pricingData: PricingData = {};
let meta: PricingMeta = {};

const DEFAULT_FREE_PROVIDERS = ['nvidia', 'ollama', 'vllm', 'lmstudio'];

function load(): void {
  try {
    pricingData = JSON.parse(fs.readFileSync(pricingPath, 'utf-8'));
  } catch {
    pricingData = {};
  }
  const m = pricingData['$meta'] as PricingMeta | undefined;
  meta = m || {};
}

load();

export function reload(): void {
  load();
}

export function getMeta(): PricingMeta {
  return { ...meta };
}

function isProviderFree(provider: string): boolean {
  if (!meta.autoFree) return false;
  const free = meta.freeProviders || DEFAULT_FREE_PROVIDERS;
  return free.includes(provider);
}

function getProviderPricing(provider: string): ProviderPricing | undefined {
  const prov = pricingData[provider] as ProviderPricing | undefined;
  if (!prov) return undefined;
  return prov;
}

export function getPrice(provider: string, model: string): PriceEntry {
  if (isProviderFree(provider)) return { input: 0, output: 0 };
  const prov = getProviderPricing(provider);
  if (!prov) return { input: 0, output: 0 };
  const exact = prov[model];
  if (exact) return exact;
  for (const [key, val] of Object.entries(prov)) {
    if (key !== 'default' && (model.startsWith(key) || model.includes(key))) return val;
  }
  const def = prov['default'];
  return def || { input: 0, output: 0 };
}

export function calculateCost(provider: string, model: string, promptTokens: number, outputTokens: number): number {
  if (!provider) return 0;
  const price = getPrice(provider, model);
  const cost = (promptTokens * price.input + outputTokens * price.output) / 1_000_000;
  return cost < 0.00000001 ? 0 : cost;
}

export function getAllPricing(): PricingData {
  return pricingData;
}

export function savePricing(data: PricingData): boolean {
  try {
    pricingData = data;
    const m = data['$meta'] as PricingMeta | undefined;
    if (m) meta = m;
    fs.writeFileSync(pricingPath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch { return false; }
}

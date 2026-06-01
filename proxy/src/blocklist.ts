import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOCKLIST_PATH = path.resolve(__dirname, '..', 'blocklist.json');

interface BlocklistData {
  blockedProviders: string[];
  blockedModels: string[];
  contentPatterns: string[];
}

let blocklist: BlocklistData = { blockedProviders: [], blockedModels: [], contentPatterns: [] };

function load(): void {
  try {
    if (fs.existsSync(BLOCKLIST_PATH)) {
      blocklist = JSON.parse(fs.readFileSync(BLOCKLIST_PATH, 'utf-8'));
    }
  } catch {
    blocklist = { blockedProviders: [], blockedModels: [], contentPatterns: [] };
  }
}

load();

export function reload(): void {
  load();
}

export function checkBlocked(providers: string | string[], model: string, content?: string): { blocked: boolean; reason?: string } {
  const providerList = Array.isArray(providers) ? providers : [providers];
  for (const p of providerList) {
    if (blocklist.blockedProviders.includes(p)) {
      return { blocked: true, reason: `Provider "${p}" is blocked` };
    }
  }
  if (blocklist.blockedModels.some(p => model === p || model.includes(p) || model.startsWith(p.replace('*', '')) || (p.includes('*') && new RegExp('^' + p.replace(/\*/g, '.*') + '$').test(model)))) {
    return { blocked: true, reason: `Model "${model}" matches a blocked pattern` };
  }
  if (content && blocklist.contentPatterns.length > 0) {
    for (const pattern of blocklist.contentPatterns) {
      try {
        if (new RegExp(pattern, 'i').test(content)) {
          return { blocked: true, reason: `Content matches blocked pattern: ${pattern}` };
        }
      } catch { /* skip invalid regex */ }
    }
  }
  return { blocked: false };
}

export function getBlocklist(): BlocklistData {
  return { ...blocklist, blockedProviders: [...blocklist.blockedProviders], blockedModels: [...blocklist.blockedModels], contentPatterns: [...blocklist.contentPatterns] };
}

export function saveBlocklist(data: BlocklistData): boolean {
  try {
    blocklist = { blockedProviders: data.blockedProviders || [], blockedModels: data.blockedModels || [], contentPatterns: data.contentPatterns || [] };
    fs.writeFileSync(BLOCKLIST_PATH, JSON.stringify(blocklist, null, 2), 'utf-8');
    logger.info('[blocklist] Saved');
    return true;
  } catch (e: any) {
    logger.error('[blocklist] Save failed', { error: e.message });
    return false;
  }
}

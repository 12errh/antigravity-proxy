import fs from 'fs';
import path from 'path';
import * as readline from 'readline';
import { USER_ENV_PATH as ENV_PATH, ENV_EXAMPLE } from '../utils/paths.js';

const PROVIDERS = [
  { id: 'openrouter', name: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', placeholder: 'sk-or-v1-...' },
  { id: 'nvidia', name: 'NVIDIA', envKey: 'NVIDIA_API_KEY', placeholder: 'nvapi-...' },
  { id: 'openai', name: 'OpenAI', envKey: 'OPENAI_API_KEY', placeholder: 'sk-...' },
  { id: 'anthropic', name: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', placeholder: 'sk-ant-...' },
  { id: 'groq', name: 'Groq', envKey: 'GROQ_API_KEY', placeholder: 'gsk_...' },
  { id: 'google', name: 'Google AI', envKey: 'GOOGLE_API_KEY', placeholder: 'AIza...' },
  { id: 'zen', name: 'OpenCode Zen', envKey: 'OPENCODE_API_KEY', placeholder: 'sk-...' },
  { id: 'opencode-go', name: 'OpenCode Go', envKey: 'OPENCODE_GO_API_KEY', placeholder: 'sk-...' },
  { id: 'ollama', name: 'Ollama (local)', envKey: '', placeholder: '' },
  { id: 'vllm', name: 'vLLM (local)', envKey: '', placeholder: '' },
  { id: 'lmstudio', name: 'LM Studio (local)', envKey: '', placeholder: '' },
];

function createRl(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function maskKey(key: string): string {
  if (!key || key.length < 10) return key;
  return key.slice(0, 6) + '***' + key.slice(-4);
}

function ensureEnvExists(): void {
  if (!fs.existsSync(ENV_PATH) && fs.existsSync(ENV_EXAMPLE)) {
    fs.copyFileSync(ENV_EXAMPLE, ENV_PATH);
  }
}

function readEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(ENV_PATH, 'utf-8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)/);
      if (m) result[m[1]] = m[2].trim();
    }
  } catch { /* .env may not exist */ }
  return result;
}

function writeEnv(updates: Record<string, string>): void {
  let raw = '';
  try { raw = fs.readFileSync(ENV_PATH, 'utf-8'); } catch { raw = ''; }
  for (const [k, v] of Object.entries(updates)) {
    const re = new RegExp(`^${k}=.*`, 'm');
    if (re.test(raw)) raw = raw.replace(re, `${k}=${v}`);
    else raw += `\n${k}=${v}`;
  }
  fs.writeFileSync(ENV_PATH, raw, 'utf-8');
}

export async function setupCommand(): Promise<void> {
  // Step 0: Ensure .env exists from template (never overwrite existing keys)
  ensureEnvExists();

  const rl = createRl();
  const env = readEnv();

  console.log('');
  console.log('  ==========================================');
  console.log('   Antigravity - Setup Wizard');
  console.log('  ==========================================');
  console.log('');

  // Show existing config if any
  const existingKeys = Object.keys(env).filter(k => k.includes('API_KEY') && env[k]);
  if (existingKeys.length > 0) {
    console.log('  Existing configuration detected:');
    for (const k of existingKeys) {
      console.log(`    ${k}=${maskKey(env[k])}`);
    }
    console.log('');
  }

  console.log('  This wizard will configure your first provider.');
  console.log('  You can add more providers later from the dashboard.');
  console.log('');

  // 1. Select provider
  console.log('  Available providers:');
  for (let i = 0; i < PROVIDERS.length; i++) {
    console.log(`    ${i + 1}. ${PROVIDERS[i].name}`);
  }
  console.log('');
  const providerIdx = parseInt(await ask(rl, '  Select provider [1]: '), 10) - 1;
  const provider = PROVIDERS[Math.max(0, Math.min(providerIdx, PROVIDERS.length - 1))];
  console.log(`  Selected: ${provider.name}`);
  console.log('');

  // 2. API key (skip for Ollama)
  let apiKey = '';
  if (provider.envKey) {
    const existingKey = env[provider.envKey] || '';
    if (existingKey && existingKey !== `sk-...` && !existingKey.startsWith('sk-...')) {
      console.log(`  Existing ${provider.name} key: ${maskKey(existingKey)}`);
      const keep = await ask(rl, '  Keep existing key? [Y/n]: ');
      if (keep.toLowerCase() !== 'n') {
        apiKey = existingKey;
        console.log('  Keeping existing key');
        console.log('');
      }
    }
    if (!apiKey) {
      console.log(`  Enter your ${provider.name} API key.`);
      console.log(`  (Leave blank to skip - you can set it later in the dashboard)`);
      console.log('');
      apiKey = await ask(rl, `  API key: `);
      if (apiKey) {
        console.log(`  Key: ${maskKey(apiKey)}`);
      } else {
        console.log('  Skipped - set it later from the dashboard Config tab.');
      }
      console.log('');
    }
  }

  // 3. Proxy port
  console.log('  Select proxy port:');
  console.log('    1. 443   (default, requires admin/root)');
  console.log('    2. 8443  (no admin needed)');
  console.log('');
  const currentPort = env['PROXY_PORT'] || '443';
  const portChoice = parseInt(await ask(rl, `  Port [${currentPort === '8443' ? '2' : '1'}]: `), 10);
  const proxyPort = portChoice === 2 ? '8443' : currentPort;
  console.log(`  Port: ${proxyPort}`);
  console.log('');

  // 4. Context strip mode
  console.log('  Context strip mode:');
  console.log('    1. lite (recommended) - compressed context, ~66% fewer tokens');
  console.log('    2. strip              - remove skills/plugins, inject full agent-context.md');
  console.log('    3. passthrough        - send full Antigravity context unchanged');
  console.log('');
  const currentMode = env['CONTEXT_STRIP_MODE'] || 'passthrough';
  let defaultChoice = '1';
  if (currentMode === 'strip') defaultChoice = '2';
  else if (currentMode === 'passthrough') defaultChoice = '3';
  const stripChoice = parseInt(await ask(rl, `  Mode [${defaultChoice}]: `), 10) || 1;
  const contextMode = stripChoice === 2 ? 'strip' : stripChoice === 3 ? 'passthrough' : 'lite';
  console.log(`  Mode: ${contextMode}`);
  console.log('');

  // 5. Auto-trust certificates
  console.log('  Auto-trust TLS certificate on this machine?');
  const trustChoice = await ask(rl, '  Trust cert? [Y/n]: ');
  const trustCerts = trustChoice.toLowerCase() !== 'n';
  console.log('');

  // 6. Dashboard auth
  console.log('  Set up dashboard authentication?');
  const existingUser = env['DASHBOARD_USER'] || '';
  if (existingUser) {
    console.log(`  Existing auth user: ${existingUser}`);
  }
  const authChoice = await ask(rl, existingUser ? '  Keep existing auth? [Y/n]: ' : '  Enable auth? [y/N]: ');
  let dashUser = existingUser;
  let dashPass = env['DASHBOARD_PASSWORD'] || '';
  if (existingUser && authChoice.toLowerCase() !== 'n') {
    console.log('  Keeping existing auth');
  } else if (authChoice.toLowerCase() === 'y') {
    dashUser = await ask(rl, '  Username: ');
    dashPass = await ask(rl, '  Password: ');
  } else {
    dashUser = '';
    dashPass = '';
  }
  console.log('');

  // Write only the changes — .env.example template is already the base
  const updates: Record<string, string> = {};
  updates['PROVIDER_PRIORITY'] = provider.id;
  if (provider.envKey && apiKey) {
    updates[provider.envKey] = apiKey;
  }
  updates['PROXY_PORT'] = proxyPort;
  updates['CONTEXT_STRIP_MODE'] = contextMode;
  if (dashUser && dashPass) {
    updates['DASHBOARD_USER'] = dashUser;
    updates['DASHBOARD_PASSWORD'] = dashPass;
  } else {
    updates['DASHBOARD_USER'] = '';
    updates['DASHBOARD_PASSWORD'] = '';
  }

  writeEnv(updates);
  console.log('==> Configuration saved to .env');
  console.log('');

  // Ask to start proxy
  const startChoice = await ask(rl, '  Start the proxy now? [Y/n]: ');
  rl.close();

  if (startChoice.toLowerCase() !== 'n') {
    console.log('');
    const { startCommand } = await import('./start.js');
    await startCommand({ port: proxyPort, browser: true, trustCert: trustCerts });
  } else {
    console.log('');
    console.log('  Run `antigravity start` when ready.');
    console.log('  Run `antigravity start --trust-cert` to auto-trust the TLS certificate.');
    console.log('');
  }
}

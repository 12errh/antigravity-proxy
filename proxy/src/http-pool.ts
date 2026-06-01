import { Agent, fetch as undiciFetch } from 'undici';

const DEFAULT_OPTS = {
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 120_000,
  connections: 25,
  connectTimeout: 10_000,
};

class HttpPool {
  private agents = new Map<string, Agent>();
  private closing = false;

  getAgent(urlStr: string): Agent | undefined {
    if (this.closing) return undefined;
    try {
      const url = new URL(urlStr);
      const key = url.origin;
      let agent = this.agents.get(key);
      if (!agent) {
        agent = new Agent({
          keepAliveTimeout: DEFAULT_OPTS.keepAliveTimeout,
          keepAliveMaxTimeout: DEFAULT_OPTS.keepAliveMaxTimeout,
          connections: DEFAULT_OPTS.connections,
          pipelining: 1,
          connect: {
            timeout: DEFAULT_OPTS.connectTimeout,
            rejectUnauthorized: true,
          },
        });
        this.agents.set(key, agent);
      }
      return agent;
    } catch {
      return undefined;
    }
  }

  async closeAll(): Promise<void> {
    this.closing = true;
    const entries = Array.from(this.agents.entries());
    this.agents.clear();
    await Promise.allSettled(entries.map(([, a]) => a.close()));
  }
}

export const httpPool = new HttpPool();

export async function poolFetch(url: string, init?: RequestInit): Promise<Response> {
  const agent = httpPool.getAgent(url);
  const opts: Record<string, unknown> = init ? { ...init } : {};
  if (agent) opts.dispatcher = agent;
  return undiciFetch(url, opts as any) as unknown as Response;
}

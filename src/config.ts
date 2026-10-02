export type Config = {
  origin: string;
  secure: boolean;
  sessionSecret: string;
  dataPath: string;
  port: number;
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret) throw new Error('SESSION_SECRET is required');
  const rawOrigin = env.PUBLIC_BASE_URL;
  if (!rawOrigin) throw new Error('PUBLIC_BASE_URL is required');
  const { origin, secure } = parseOrigin(rawOrigin);
  const dataPath = env.DATA_PATH || '/data/gost.sqlite';
  const port = env.PORT ? Number(env.PORT) : 8080;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is invalid');
  return { origin, secure, sessionSecret, dataPath, port };
}

function parseOrigin(raw: string): { origin: string; secure: boolean } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('PUBLIC_BASE_URL must be an absolute origin');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('PUBLIC_BASE_URL must be an absolute http or https origin');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('PUBLIC_BASE_URL must be an origin with no path');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('PUBLIC_BASE_URL must be an origin with no path');
  }
  return { origin: url.origin, secure: url.protocol === 'https:' };
}

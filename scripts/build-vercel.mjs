import { cp, mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const isVercelBuild = process.env.VERCEL === '1';
const configuredApiUrl = process.env.TRAINTRACK_API_URL?.trim() || '';

function getApiOrigin(value) {
  if (!value) {
    if (isVercelBuild) throw new Error('TRAINTRACK_API_URL is required for Vercel builds.');
    return '';
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('TRAINTRACK_API_URL must be an absolute backend origin, such as https://api.example.com.');
  }

  const isLocalHost = url.hostname === 'localhost'
    || url.hostname.endsWith('.localhost')
    || url.hostname === '127.0.0.1'
    || url.hostname === '[::1]';
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
    || (isVercelBuild && (url.protocol !== 'https:' || isLocalHost))
  ) {
    throw new Error('TRAINTRACK_API_URL must be a public HTTPS origin without a path, credentials, query, or fragment.');
  }

  return url.origin;
}

const apiOrigin = getApiOrigin(configuredApiUrl);
const websocketOrigin = apiOrigin ? apiOrigin.replace(/^https:/, 'wss:') : '';
const connectSources = ["'self'", ...(apiOrigin ? [apiOrigin, websocketOrigin] : [])].join(' ');
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  `connect-src ${connectSources}`,
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, 'public'), output, { recursive: true });

const views = path.join(root, 'views');
for (const name of ['index', 'login', 'passenger', 'contact', 'controller', 'admin']) {
  const source = path.join(views, `${name}.html`);
  let html = await readFile(source, 'utf8');
  const commonScript = '  <script src="/js/common.js"></script>';
  if (!html.includes(commonScript)) {
    throw new Error(`Expected shared frontend script tag was not found in views/${name}.html.`);
  }
  html = html.replace(
    commonScript,
    '  <script src="/js/runtime-config.js"></script>\n' + commonScript
  );

  const socketScript = '  <script src="/socket.io/socket.io.js"></script>';
  if (html.includes(socketScript)) {
    html = html.replace(socketScript, '  <script src="/vendor/socket.io.min.js"></script>');
  } else {
    html = html.replace(
      commonScript,
      '  <script src="/vendor/socket.io.min.js"></script>\n' + commonScript
    );
  }

  if (!html.includes('</head>')) throw new Error(`Missing </head> in views/${name}.html.`);
  html = html.replace('</head>', `  <meta http-equiv="Content-Security-Policy" content="${csp}">\n</head>`);
  await writeFile(path.join(output, `${name}.html`), html);
}

const runtimeConfig = `window.TRAINTRACK_CONFIG = Object.freeze(${JSON.stringify({ apiBaseUrl: apiOrigin })});\n`;
await writeFile(path.join(output, 'js', 'runtime-config.js'), runtimeConfig);
await mkdir(path.join(output, 'vendor'), { recursive: true });
await copyFile(
  path.join(root, 'node_modules', 'socket.io', 'client-dist', 'socket.io.min.js'),
  path.join(output, 'vendor', 'socket.io.min.js')
);

console.log(`Vercel frontend built in dist${apiOrigin ? ` for ${apiOrigin}` : ' (same-origin development mode)'}.`);

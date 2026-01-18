require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');
const WebSocket = require('ws');
const cheerio = require('cheerio');
const solanaWeb3 = require('@solana/web3.js');
const splToken = require('@solana/spl-token');
const bs58 = require('bs58');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const CACHE_PATH = path.join(ROOT, 'MeVoltOBS', 'pump_cache.json');
const DRIVE_DB_PATH = process.env.DRIVE_DB_PATH || path.join(ROOT, 'MeVoltOBS', 'drive_db.json');
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const PAYOUT_TOKEN = (process.env.PAYOUT_TOKEN || '').trim();
const TREASURY_SECRET_KEY = (process.env.TREASURY_SECRET_KEY || process.env.TREASURE_SECRET_KEY || '').trim();

function defaultSlotState() {
  return {
    dailySpins: {},
    userPoints: {},
    jackpot: 1000,
    dailyNFTCount: 0,
    dailyPurchasesSOL: 0,
    yesterdayPurchasesSOL: 0,
    lastResetDate: new Date().toDateString()
  };
}

function defaultDriveDb() {
  return { chats: [], logs: [], winners: [], slotState: defaultSlotState() };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function safeJoin(base, target) {
  const targetPath = path.normalize(path.join(base, target));
  if (!targetPath.startsWith(base)) return null;
  return targetPath;
}

function sendError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function readJsonFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJsonFileSafe(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function buildPumpHeaders({ includeCookie = true } = {}) {
  const rawCookie = process.env.PUMPFUN_COOKIE || '';
  const jwtFromEnv = process.env.PUMPFUN_JWT || '';
  const jwtFromCookie = rawCookie.match(/(?:^|;\s*)auth_token=([^;]+)/)?.[1] || '';
  const jwt = jwtFromEnv || jwtFromCookie;

  const headers = {
    'User-Agent': 'MeVoltOBS-Proxy/1.0',
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://pump.fun',
    Referer: 'https://pump.fun/'
  };
  if (includeCookie && rawCookie) headers.Cookie = rawCookie;
  if (jwt) {
    headers.Authorization = `Bearer ${jwt}`;
    headers['auth-token'] = jwt;
  }
  return { headers, jwt, rawCookie };
}

function decodeJwtPayload(jwt) {
  try {
    if (!jwt) return null;
    const parts = String(jwt).split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replaceAll('-', '+').replaceAll('_', '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getViewerIdentity(jwt) {
  const payload = decodeJwtPayload(jwt) || {};
  const addr = (payload.address || payload.userAddress || payload.wallet || '').toString();
  const usernameFromEnv = (process.env.PUMPFUN_USERNAME || '').trim();
  const username = usernameFromEnv || (addr ? addr.slice(0, 4) + '...' + addr.slice(-4) : 'viewer');
  const userId = addr || (payload.sub || '').toString() || null;
  return { userId, username, address: addr || null };
}

async function fetchText(url, { headers } = {}) {
  const res = await fetch(url, { method: 'GET', headers });
  const text = await res.text();
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), text };
}

async function fetchJson(url, { headers } = {}) {
  const res = await fetch(url, { method: 'GET', headers });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), json, text };
}

async function postJson(url, body, { headers } = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), json, text };
}

const ALLOWED_PROXY_HOSTS = new Set([
  'pump.fun',
  'livechat.pump.fun',
  'pumpportal.fun',
  'frontend-api-v3.pump.fun',
  'api.dexscreener.com',
  'api.solscan.io',
  'public-api.solscan.io'
]);

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizePumpUrl(href) {
  if (!href) return null;
  try {
    if (href.startsWith('http://') || href.startsWith('https://')) return href;
    if (href.startsWith('/')) return `https://pump.fun${href}`;
    return `https://pump.fun/${href}`;
  } catch {
    return null;
  }
}

function injectBaseHref(html, baseHref) {
  const baseTag = `<base href="${baseHref}">`;
  if (/<base\s/i.test(html)) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}\n${baseTag}\n`);
  }
  return `${baseTag}\n${html}`;
}

// In-memory cache: profileUrl -> { wallet, fetchedAt }
const PROFILE_WALLET_TTL_MS = Math.max(60_000, Number(process.env.PROFILE_WALLET_TTL_MS || 6 * 60 * 60 * 1000)); // default 6h
const profileWalletCache = new Map();

async function fetchProfileWallet(profileUrl, pumpHeaders) {
  const url = normalizePumpUrl(profileUrl);
  if (!url) return null;

  const cached = profileWalletCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < PROFILE_WALLET_TTL_MS) return cached.wallet || null;

  const res = await fetchText(url, { headers: pumpHeaders });
  if (res.status < 200 || res.status >= 300) {
    profileWalletCache.set(url, { wallet: null, fetchedAt: Date.now() });
    return null;
  }

  const $ = cheerio.load(res.text || '');
  const solscanHref =
    $('a[href^="https://solscan.io/account/"]').first().attr('href') ||
    $('a[href^="https://solscan.io/account/"]').first().attr('href');

  const wallet = solscanHref ? solscanHref.split('/account/')[1]?.split(/[?#]/)[0] : null;
  profileWalletCache.set(url, { wallet: wallet || null, fetchedAt: Date.now() });
  return wallet || null;
}

function pickChatContainer($) {
  // Primary selector: the exact class list (or subset) the user referenced
  let $container = $('div.flex.flex-col.overflow-hidden.rounded-lg.bg-bg-secondary').first();
  if ($container && $container.length) return $container;

  // Fallback: find any container with "bg-bg-secondary" and many links to /profile/
  const candidates = $('div.bg-bg-secondary').toArray().map((el) => $(el));
  let best = null;
  let bestScore = 0;
  for (const $c of candidates) {
    const profileLinks = $c.find('a[href*="/profile/"],a[href^="https://pump.fun/profile/"]').length;
    const textLen = ($c.text() || '').trim().length;
    const score = profileLinks * 10 + Math.min(2000, textLen) / 200;
    if (score > bestScore) {
      bestScore = score;
      best = $c;
    }
  }
  return best || null;
}

function extractChatMessagesFromContainer($, $container, { maxMessages = 50 } = {}) {
  const messages = [];
  const seen = new Set();

  // Heuristic: each message usually contains a profile link anchor; group by closest block.
  const authorAnchors = $container.find('a[href*="/profile/"],a[href^="https://pump.fun/profile/"]').toArray();

  for (const a of authorAnchors) {
    const $a = $(a);
    const username = ($a.text() || '').trim();
    const profileUrl = normalizePumpUrl($a.attr('href'));
    if (!username || !profileUrl) continue;

    // Try to locate a "message root" container for this author link
    const $root =
      $a.closest('div').first().length ? $a.closest('div').first() :
      $a.parent();

    // Extract message text: prefer visible text nodes near the author link
    let messageText = '';
    const $textCandidates = $root.find('p,span,div').toArray().map((el) => $(el).text().trim()).filter(Boolean);
    // Remove the username from candidates and pick the best-looking line
    const cleaned = $textCandidates
      .map((t) => t.replace(username, '').trim())
      .filter((t) => t && t.length >= 1);
    messageText = cleaned.sort((x, y) => y.length - x.length)[0] || '';

    // If that failed, fallback to root text minus username
    if (!messageText) {
      messageText = ($root.text() || '').replace(username, '').trim();
    }

    // Clamp junk
    if (messageText.length > 500) messageText = messageText.slice(0, 500);

    const key = `${profileUrl}|${username}|${messageText}`;
    if (seen.has(key)) continue;
    seen.add(key);

    messages.push({
      username,
      profileUrl,
      message: messageText || null
    });

    if (messages.length >= maxMessages) break;
  }

  // Keep the most recent-ish messages (best effort): often later anchors correspond to recent chat
  return messages.slice(-maxMessages);
}

async function fetchJsonFromLocal(url) {
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

// Minimal CDP (Chrome DevTools Protocol) client using ws
async function cdpEvaluate({ wsUrl, expression, timeoutMs = 8000 }) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('CDP timeout'));
    }, timeoutMs);

    const send = (method, params) => {
      const msgId = ++id;
      const payload = { id: msgId, method, params: params || {} };
      pending.set(msgId, { method });
      ws.send(JSON.stringify(payload));
      return msgId;
    };

    ws.on('open', () => {
      try {
        send('Runtime.enable');
        send('Page.enable');
        send('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true
        });
      } catch (e) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        reject(e);
      }
    });

    ws.on('message', (raw) => {
      let msg = null;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.id !== 'number') return;
      const p = pending.get(msg.id);
      if (!p) return;

      pending.delete(msg.id);
      if (p.method !== 'Runtime.evaluate') return;

      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (msg.error) return reject(new Error(msg.error.message || 'CDP evaluate error'));
      const value = msg.result?.result?.value;
      resolve(value);
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      reject(err);
    });
  });
}

async function cdpCollectSocketIoMessages({ wsUrl, listenMs = 5000, maxMessages = 100 } = {}) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const requestIds = new Set();
    const messages = [];
    const seen = new Set();

    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      resolve({ ok: true, listenMs, messageCount: messages.length, messages });
    }, listenMs);

    const send = (method, params) => {
      const msgId = ++id;
      ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
      return msgId;
    };

    const parseMaybeSocketIo = (payloadData) => {
      if (typeof payloadData !== 'string') return;
      // Engine.IO / Socket.IO text frames typically start with numeric prefixes.
      // Socket.IO event packet: "42" + JSON array, e.g. 42["newMessage", {...}]
      if (!payloadData.startsWith('42')) return;
      const jsonPart = payloadData.slice(2);
      let arr = null;
      try {
        arr = JSON.parse(jsonPart);
      } catch {
        return;
      }
      if (!Array.isArray(arr) || arr.length < 2) return;
      const eventName = arr[0];
      const payload = arr[1];
      if (eventName !== 'newMessage') return;
      const msg = payload || {};
      const key = msg.id || JSON.stringify(msg);
      if (seen.has(key)) return;
      seen.add(key);
      messages.push({ event: eventName, data: msg });
    };

    ws.on('open', () => {
      try {
        send('Network.enable');
      } catch (e) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        reject(e);
      }
    });

    ws.on('message', (raw) => {
      let msg = null;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg) return;

      // Track websocket connections to livechat/socket.io
      if (msg.method === 'Network.webSocketCreated') {
        const url = msg.params?.url || '';
        if (/livechat\\.pump\\.fun|socket\\.io/i.test(url)) {
          requestIds.add(msg.params?.requestId);
        }
      }

      if (msg.method === 'Network.webSocketFrameReceived') {
        const reqId = msg.params?.requestId;
        if (!requestIds.has(reqId)) return;
        const payloadData = msg.params?.response?.payloadData;
        parseMaybeSocketIo(payloadData);
        if (messages.length >= maxMessages) {
          clearTimeout(timer);
          try { ws.close(); } catch {}
          resolve({ ok: true, listenMs, messageCount: messages.length, messages });
        }
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      reject(err);
    });
  });
}

function setSseHeaders(res) {
  setCors(res);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-payout-token');
}

function isLikelyBase58Address(s) {
  if (!s || typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (trimmed.length < 32 || trimmed.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed);
}

function readTreasuryKeypair() {
  if (!TREASURY_SECRET_KEY) return null;
  try {
    let secret;
    const trimmed = TREASURY_SECRET_KEY.trim();
    if (trimmed.startsWith('[')) {
      secret = JSON.parse(trimmed);
    } else {
      const decoded = bs58.decode(trimmed);
      secret = Array.from(decoded);
    }
    if (!Array.isArray(secret) || secret.length !== 64) return null;
    return solanaWeb3.Keypair.fromSecretKey(new Uint8Array(secret));
  } catch {
    return null;
  }
}

function isPayoutAuthorized(req) {
  if (!PAYOUT_TOKEN) return false;
  const token = (req.headers['x-payout-token'] || req.headers['x-payout-token'.toLowerCase()] || '').toString().trim();
  return token === PAYOUT_TOKEN;
}

async function sendSplToken({ toWallet, mint, amountTokens }) {
  const kp = readTreasuryKeypair();
  if (!kp) throw new Error('Treasury key not configured');
  const to = new solanaWeb3.PublicKey(toWallet);
  const mintPk = new solanaWeb3.PublicKey(mint);
  const connection = new solanaWeb3.Connection(SOLANA_RPC_URL, 'confirmed');
  
  const fromTokenAccount = await splToken.getAssociatedTokenAddress(mintPk, kp.publicKey);
  const toTokenAccount = await splToken.getAssociatedTokenAddress(mintPk, to);
  
  const amount = BigInt(Math.floor(Math.max(0, Number(amountTokens) || 0)));
  if (amount <= 0n) throw new Error('Bad amountTokens');
  
  const mintInfo = await splToken.getMint(connection, mintPk);
  const decimals = mintInfo.decimals;
  const amountWithDecimals = amount * BigInt(10 ** decimals);
  
  const tx = new solanaWeb3.Transaction().add(
    splToken.createTransferInstruction(
      fromTokenAccount,
      toTokenAccount,
      kp.publicKey,
      Number(amountWithDecimals),
      [],
      splToken.TOKEN_PROGRAM_ID
    )
  );
  
  const sig = await solanaWeb3.sendAndConfirmTransaction(connection, tx, [kp], {
    commitment: 'confirmed',
    skipPreflight: false
  });
  
  return { sig, from: kp.publicKey.toBase58(), to: to.toBase58(), amountTokens: amount.toString() };
}

function readBodyJson(req, { maxBytes = 2_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    let body = '';
    let totalBytes = 0;
    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function handleProxy(req, res, targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (!ALLOWED_PROXY_HOSTS.has(parsed.hostname)) {
      setCors(res);
      return sendError(res, 403, 'Host not allowed');
    }

    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'MeVoltOBS-Proxy/1.0'
      }
    });

    setCors(res);
    res.statusCode = upstream.status;
    const contentType = upstream.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.end(buffer);
  } catch (err) {
    setCors(res);
    return sendError(res, 502, 'Proxy error');
  }
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  const urlPath = decodeURIComponent(reqUrl.pathname);

  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    return res.end();
  }

  if (urlPath === '/health') {
    setCors(res);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (urlPath === '/proxy') {
    const targetUrl = reqUrl.searchParams.get('url');
    if (!targetUrl) {
      setCors(res);
      return sendError(res, 400, 'Missing url');
    }
    return handleProxy(req, res, targetUrl);
  }

  if (urlPath === '/render/coin') {
    const mint = reqUrl.searchParams.get('mint');
    if (!mint) {
      return sendError(res, 400, 'Missing mint');
    }
    (async () => {
      try {
        const mode = String(reqUrl.searchParams.get('mode') || 'static'); // static | interactive
        const { headers } = buildPumpHeaders({ includeCookie: true });
        const url = `https://pump.fun/coin/${encodeURIComponent(mint)}`;
        const result = await fetchText(url, { headers });
        res.statusCode = result.status;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        let html = result.text || '';

        // Default to a "static-safe" render: Pump.fun is a Next.js app and will often crash on localhost
        // due to cross-origin requests/cookies. Stripping scripts prevents the client-side exception.
        if (mode !== 'interactive') {
          const $ = cheerio.load(html);
          $('script').remove();
          // Also drop script preloads to reduce noise
          $('link[rel="preload"][as="script"]').remove();
          html = $.html();
        }

        html = injectBaseHref(html, 'https://pump.fun/');
        res.end(html);
      } catch (err) {
        sendError(res, 500, 'Render coin error');
      }
    })();
    return;
  }

  // Debug endpoint: returns ONLY the chat container HTML extracted from the coin page
  if (urlPath === '/chat-fragment') {
    const mint = reqUrl.searchParams.get('mint');
    if (!mint) {
      return sendError(res, 400, 'Missing mint');
    }
    (async () => {
      try {
        const { headers } = buildPumpHeaders({ includeCookie: true });
        const url = `https://pump.fun/coin/${encodeURIComponent(mint)}`;
        const result = await fetchText(url, { headers });

        const $ = cheerio.load(result.text || '');
        const $container = pickChatContainer($);
        const fragment = $container ? $.html($container) : '';

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Chat Fragment</title>
  <style>
    body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;background:#0b0f14;color:#e6edf3;margin:0;padding:16px}
    .meta{opacity:.8;font-size:12px;margin-bottom:12px}
    .box{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:12px;overflow:auto}
    pre{white-space:pre-wrap;word-break:break-word}
  </style>
</head>
<body>
  <div class="meta">mint=${escapeHtml(mint)} | upstreamStatus=${escapeHtml(result.status)}</div>
  <div class="box">${fragment || '<pre>(chat container not found)</pre>'}</div>
</body>
</html>`);
      } catch (err) {
        sendError(res, 500, 'Chat fragment error');
      }
    })();
    return;
  }

  // JSON endpoint: scrape chat messages + resolve wallet addresses from profile pages
  if (urlPath === '/chat-scrape') {
    const mint = reqUrl.searchParams.get('mint');
    const maxMessages = Math.max(1, Math.min(200, Number(reqUrl.searchParams.get('max') || 50)));
    const mode = String(reqUrl.searchParams.get('mode') || 'socket'); // socket | html
    const walletSource = String(reqUrl.searchParams.get('walletSource') || 'payload'); // payload | profile
    const includeWallet = String(reqUrl.searchParams.get('wallets') || '1') !== '0';
    const profileConcurrency = Math.max(1, Math.min(10, Number(reqUrl.searchParams.get('profileConcurrency') || 4)));
    const timeoutMs = Math.max(1000, Math.min(15000, Number(reqUrl.searchParams.get('timeoutMs') || 7000)));

    if (!mint) {
      setCors(res);
      return sendError(res, 400, 'Missing mint');
    }

    (async () => {
      try {
        const { headers: pumpHeaders, jwt } = buildPumpHeaders({ includeCookie: true });
        const viewer = getViewerIdentity(jwt);

        // Preferred: use the same socket events as Pump.fun frontend (joinRoom + getMessageHistory).
        if (mode === 'socket') {
          const extraHeaders = { ...pumpHeaders };
          const socket = io('https://livechat.pump.fun', {
            transports: ['websocket', 'polling'],
            reconnection: false,
            timeout: Math.min(20000, timeoutMs + 5000),
            extraHeaders,
            auth: jwt ? { token: jwt, auth_token: jwt, username: viewer.username } : undefined
          });

          const result = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('chat-scrape timeout')), timeoutMs);

            const cleanup = () => {
              clearTimeout(timer);
              try {
                socket.disconnect();
              } catch {
                // ignore
              }
            };

            socket.on('connect', () => {
              socket.emit('joinRoom', { roomId: mint, username: viewer.username }, (ack) => {
                socket.emit('getMessageHistory', { roomId: mint, before: null, limit: maxMessages }, (history) => {
                  cleanup();
                  resolve({ ack: ack || null, history });
                });
              });
            });

            socket.on('connect_error', (err) => {
              cleanup();
              reject(err);
            });
          });

          const ack = result?.ack || null;
          const hist = result?.history;
          const rawMessages = Array.isArray(hist) ? hist : (hist && (hist.messages || hist.data || hist.items)) || [];

          const mapped = (Array.isArray(rawMessages) ? rawMessages : []).map((e) => {
            const username = (e?.username || '').toString().trim();
            const userAddress = (e?.userAddress || '').toString().trim();
            const profileUrl = userAddress ? `https://pump.fun/profile/${userAddress}` : null;
            let msg = e?.message;
            let messageText = '';
            if (typeof msg === 'string') messageText = msg;
            else if (Array.isArray(msg)) messageText = String(msg[0] || '');
            else if (msg != null) messageText = String(msg);

            return {
              id: e?.id || null,
              roomId: e?.roomId || mint,
              username: username || null,
              profileUrl,
              message: messageText || null,
              wallet: includeWallet ? (walletSource === 'payload' ? (userAddress || null) : null) : null,
              timestamp: e?.timestamp || null
            };
          }).filter((m) => m.username || m.message);

          // Optional: resolve wallet via profile page (slow, rate-limited)
          if (includeWallet && walletSource === 'profile') {
            let idx = 0;
            const out = new Array(mapped.length);
            const worker = async () => {
              while (idx < mapped.length) {
                const i = idx++;
                const m = mapped[i];
                let wallet = null;
                if (m.profileUrl) {
                  try {
                    wallet = await fetchProfileWallet(m.profileUrl, pumpHeaders);
                  } catch {
                    wallet = null;
                  }
                }
                out[i] = { ...m, wallet: wallet || null };
              }
            };
            const workers = Array.from({ length: Math.min(profileConcurrency, mapped.length || 1) }, worker);
            await Promise.all(workers);

            setCors(res);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({
              ok: true,
              mode: 'socket',
              mint,
              fetchedAt: Date.now(),
              messageCount: out.filter(Boolean).length,
              messages: out.filter(Boolean)
            }, null, 2));
            return;
          }

          setCors(res);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            ok: true,
            mode: 'socket',
            mint,
            fetchedAt: Date.now(),
            join: {
              authenticated: ack?.authenticated ?? null,
              userAddress: ack?.userAddress ?? null,
              isCreator: ack?.isCreator ?? null,
              isRoomModerator: ack?.isRoomModerator ?? null
            },
            messageCount: mapped.length,
            messages: mapped
          }, null, 2));
          return;
        }

        // Fallback: HTML scrape (often empty because chat is client-rendered)
        const url = `https://pump.fun/coin/${encodeURIComponent(mint)}`;
        const coinRes = await fetchText(url, { headers: pumpHeaders });
        const $ = cheerio.load(coinRes.text || '');
        const $container = pickChatContainer($);
        const baseMessages = $container ? extractChatMessagesFromContainer($, $container, { maxMessages }) : [];

        setCors(res);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          ok: true,
          mode: 'html',
          mint,
          fetchedAt: Date.now(),
          upstreamStatus: coinRes.status,
          messageCount: baseMessages.length,
          messages: baseMessages
        }, null, 2));
      } catch (err) {
        setCors(res);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: err.message }, null, 2));
      }
    })();
    return;
  }

  // "Evasive" method: read chat from a user-authenticated Chrome tab via CDP (remote debugging).
  // Requires Chrome running with --remote-debugging-port=9222 and an authenticated pump.fun tab open.
  if (urlPath === '/chat-browser-scrape') {
    const mint = reqUrl.searchParams.get('mint');
    const cdpPort = Math.max(1, Math.min(65535, Number(reqUrl.searchParams.get('cdpPort') || 9222)));
    const maxMessages = Math.max(1, Math.min(200, Number(reqUrl.searchParams.get('max') || 50)));
    const pollMs = Math.max(200, Math.min(5000, Number(reqUrl.searchParams.get('pollMs') || 500)));
    const pollCount = Math.max(1, Math.min(40, Number(reqUrl.searchParams.get('pollCount') || 10)));
    const openIfMissing = String(reqUrl.searchParams.get('open') || '0') === '1';
    const debug = String(reqUrl.searchParams.get('debug') || '0') === '1';
    const prefer = String(reqUrl.searchParams.get('prefer') || 'chat'); // chat | any

    if (!mint) {
      setCors(res);
      return sendError(res, 400, 'Missing mint');
    }

    (async () => {
      try {
        const listUrl = `http://127.0.0.1:${cdpPort}/json`;
        const list = await fetchJsonFromLocal(listUrl);
        if (list.status !== 200 || !Array.isArray(list.json)) {
          setCors(res);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: 'CDP not available', hint: `Start Chrome with --remote-debugging-port=${cdpPort}` }, null, 2));
          return;
        }

        const targetUrl = `https://pump.fun/coin/${encodeURIComponent(mint)}`;
        let target = list.json.find((t) => t.type === 'page' && typeof t.url === 'string' && t.url.startsWith(targetUrl));

        if (!target && openIfMissing) {
          const newUrl = `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(targetUrl)}`;
          const created = await fetchJsonFromLocal(newUrl);
          if (created.status === 200 && created.json?.webSocketDebuggerUrl) {
            target = created.json;
          }
        }

        if (!target || !target.webSocketDebuggerUrl) {
          setCors(res);
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            ok: false,
            error: 'No matching Chrome tab found',
            hint: `Open ${targetUrl} in Chrome (already logged in) and start Chrome with --remote-debugging-port=${cdpPort}`
          }, null, 2));
          return;
        }

        const expr = `(()=>{
          const max=${maxMessages};
          const wantDebug=${debug ? 'true' : 'false'};
          const preferChat=${prefer === 'chat' ? 'true' : 'false'};

          // Find the *best* container: maximize number of /profile/ links, avoid picking unrelated bg panels.
          const profileAnchorsAll = Array.from(document.querySelectorAll('a[href*=\"/profile/\"]'));
          const containerScores = new Map();

          for (const a of profileAnchorsAll) {
            let el = a;
            for (let depth = 0; depth < 8 && el; depth++) {
              el = el.parentElement;
              if (!el) break;
              if (el.tagName === 'DIV' || el.tagName === 'SECTION' || el.tagName === 'ASIDE') {
                const key = el;
                containerScores.set(key, (containerScores.get(key) || 0) + 1);
                // Stop climbing early if this looks like a panel
                const cls = (el.getAttribute('class') || '');
                if (cls.includes('rounded') || cls.includes('overflow-hidden') || cls.includes('shadow')) break;
              }
            }
          }

          let best = null;
          let bestScore = 0;
          for (const [el, score] of containerScores.entries()) {
            // Prefer smaller, more specific containers: penalize huge text blobs
            const textLen = (el.textContent || '').trim().length;
            const hasComposer =
              !!el.querySelector('textarea') ||
              !!el.querySelector('input[type=\"text\"]') ||
              !!el.querySelector('[contenteditable=\"true\"]');
            const hasSendButton = Array.from(el.querySelectorAll('button'))
              .some(b => /send|enviar|post|submit/i.test((b.textContent||'').trim()));
            const text = (el.textContent || '');
            const tradeLike = (text.match(/\\b(Buy|Sell)\\b/gi) || []).length;
            const chatLike = /\\b(chat|live chat)\\b/i.test(text) || hasComposer || hasSendButton;
            const weighted =
              score * 10 +
              (hasComposer ? 80 : 0) +
              (hasSendButton ? 20 : 0) -
              Math.min(5000, textLen) / 500 -
              // If we want chat, penalize trade-like panels heavily
              (preferChat ? tradeLike * 5 : 0) +
              (preferChat && chatLike ? 30 : 0);
            if (weighted > bestScore) {
              bestScore = weighted;
              best = el;
            }
          }

          // Separately score containers that include a "composer" (chat input). This helps when chat usernames
          // are NOT rendered as /profile/ links (common on some Pump.fun layouts).
          // Consider ancestor panels around the composer, not just the immediate wrapper.
          const composerInputs = Array.from(document.querySelectorAll('textarea, input[type=\"text\"], [contenteditable=\"true\"]'));
          const composerAncestors = [];
          for (const inp of composerInputs) {
            let el = inp;
            for (let depth = 0; depth < 10 && el; depth++) {
              el = el.parentElement;
              if (!el) break;
              if (el.tagName === 'DIV' || el.tagName === 'SECTION' || el.tagName === 'ASIDE') {
                composerAncestors.push(el);
                const cls = (el.getAttribute('class') || '');
                if (cls.includes('rounded') || cls.includes('overflow-hidden') || cls.includes('shadow')) break;
              }
            }
          }
          const uniqComposer = Array.from(new Set(composerAncestors));
          let composerBest = null;
          let composerBestScore = -1e9;
          for (const el of uniqComposer) {
            const textLen = (el.textContent || '').trim().length;
            const text = (el.textContent || '');
            const hasSendButton = Array.from(el.querySelectorAll('button'))
              .some(b => /send|enviar|post|submit/i.test((b.textContent||'').trim()));
            const chatWord = /\\b(chat|live chat)\\b/i.test(text);
            const tradeLike = (text.match(/\\b(Buy|Sell)\\b/gi) || []).length;
            const hasManyDivs = el.querySelectorAll('div').length;
            const score =
              (chatWord ? 50 : 0) +
              (hasSendButton ? 20 : 0) -
              tradeLike * 10 -
              Math.min(5000, textLen) / 500 +
              Math.min(50, hasManyDivs / 20);
            if (score > composerBestScore) {
              composerBestScore = score;
              composerBest = el;
            }
          }

          // If we prefer chat and we found a composer container, use it even if it has fewer/no profile links.
          if (preferChat && composerBest) {
            best = composerBest;
            bestScore = composerBestScore;
          }

          // Fallback: older markup (if no anchors yet), try chat-like panels
          if (!best) {
            // Prefer composer-containing containers first
            const composerContainers = Array.from(document.querySelectorAll('textarea, input[type=\"text\"], [contenteditable=\"true\"]'))
              .map(el => el.closest('div,section,aside'))
              .filter(Boolean);
            best = composerContainers[0] || null;
            if (!best) {
              const candidates = Array.from(document.querySelectorAll('div'))
                .filter(d => (d.getAttribute('class')||'').includes('bg-bg-secondary'));
              best = candidates[0] || null;
            }
          }

          if(!best) return { ok:true, messageCount:0, messages:[], note:'container_not_found', debug: wantDebug ? { totalProfileAnchors: profileAnchorsAll.length } : null };

          const anchors = Array.from(best.querySelectorAll('a[href*=\"/profile/\"]'));
          const msgs = [];
          const seen = new Set();

          if (anchors.length) {
            for (const a of anchors) {
              const username = (a.textContent||'').trim();
              const href = a.href || a.getAttribute('href') || '';
              if (!username || !href) continue;
              const profileUrl = href.startsWith('http') ? href : ('https://pump.fun' + (href.startsWith('/')?href:('/'+href)));
              const wallet = profileUrl.split('/profile/')[1]?.split(/[?#]/)[0] || null;

              const root = a.closest('div') || a.parentElement;
              let text = '';
              if (root) {
                const candidates = Array.from(root.querySelectorAll('p,span,div'))
                  .map(el => (el.textContent||'').trim())
                  .filter(Boolean)
                  .map(t => t.replace(username,'').trim())
                  .filter(t => t && t.length<=500);
                text = candidates.sort((x,y)=>y.length-x.length)[0] || '';
                if(!text) text = ((root.textContent||'').replace(username,'').trim()).slice(0,500);
              }

              const key = profileUrl + '|' + username + '|' + text;
              if (seen.has(key)) continue;
              seen.add(key);
              msgs.push({ username, profileUrl, wallet, message: text || null });
              if (msgs.length >= max) break;
            }
          } else {
            // No profile links: return raw lines as a fallback (wallet unknown)
            const raw = (best.textContent || '').split(/\\r?\\n/).map(s => s.trim()).filter(Boolean);
            for (const line of raw.slice(0, max)) {
              if (seen.has(line)) continue;
              seen.add(line);
              msgs.push({ username: null, profileUrl: null, wallet: null, message: line });
            }
          }

          const dbg = wantDebug ? {
            totalProfileAnchors: profileAnchorsAll.length,
            containerTag: best.tagName,
            containerClass: best.getAttribute('class') || '',
            containerAnchorCount: anchors.length,
            score: bestScore,
            hasComposer: !!best.querySelector('textarea, input[type=\"text\"], [contenteditable=\"true\"]'),
            preferChat,
            containerTextSample: (best.textContent || '').trim().slice(0, 200)
          } : null;

          return { ok:true, messageCount: msgs.length, messages: msgs.slice(-max), debug: dbg };
        })()`;

        let last = null;
        for (let i = 0; i < pollCount; i++) {
          const out = await cdpEvaluate({ wsUrl: target.webSocketDebuggerUrl, expression: expr, timeoutMs: 8000 });
          last = out;
          if (out && out.messageCount && out.messageCount > 0) break;
          await new Promise(r => setTimeout(r, pollMs));
        }

        setCors(res);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          ok: true,
          mode: 'browser',
          mint,
          fetchedAt: Date.now(),
          messageCount: last?.messageCount || 0,
          messages: last?.messages || [],
          note: last?.note || null,
          debug: last?.debug || null
        }, null, 2));
      } catch (err) {
        setCors(res);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: err.message }, null, 2));
      }
    })();
    return;
  }

  // Most evasive: attach to authenticated Chrome tab and sniff Socket.IO WS frames for new chat messages.
  // This returns only *new* messages that arrive during the listen window.
  if (urlPath === '/chat-browser-ws') {
    const mint = reqUrl.searchParams.get('mint');
    const cdpPort = Math.max(1, Math.min(65535, Number(reqUrl.searchParams.get('cdpPort') || 9222)));
    const listenMs = Math.max(500, Math.min(30000, Number(reqUrl.searchParams.get('listenMs') || 5000)));
    const maxMessages = Math.max(1, Math.min(500, Number(reqUrl.searchParams.get('max') || 100)));
    const openIfMissing = String(reqUrl.searchParams.get('open') || '0') === '1';

    if (!mint) {
      setCors(res);
      return sendError(res, 400, 'Missing mint');
    }

    (async () => {
      try {
        const listUrl = `http://127.0.0.1:${cdpPort}/json`;
        const list = await fetchJsonFromLocal(listUrl);
        if (list.status !== 200 || !Array.isArray(list.json)) {
          setCors(res);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: 'CDP not available', hint: `Start Chrome with --remote-debugging-port=${cdpPort}` }, null, 2));
          return;
        }

        const targetUrl = `https://pump.fun/coin/${encodeURIComponent(mint)}`;
        let target = list.json.find((t) => t.type === 'page' && typeof t.url === 'string' && t.url.startsWith(targetUrl));

        if (!target && openIfMissing) {
          const newUrl = `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(targetUrl)}`;
          const created = await fetchJsonFromLocal(newUrl);
          if (created.status === 200 && created.json?.webSocketDebuggerUrl) target = created.json;
        }

        if (!target || !target.webSocketDebuggerUrl) {
          setCors(res);
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            ok: false,
            error: 'No matching Chrome tab found',
            hint: `Open ${targetUrl} in Chrome (already logged in) and start Chrome with --remote-debugging-port=${cdpPort}`
          }, null, 2));
          return;
        }

        const sniff = await cdpCollectSocketIoMessages({ wsUrl: target.webSocketDebuggerUrl, listenMs, maxMessages });

        // Normalize to { username, wallet, message, timestamp, id }
        const normalized = (sniff.messages || []).map((m) => {
          const e = m.data || {};
          return {
            id: e.id || null,
            roomId: e.roomId || null,
            username: e.username || null,
            wallet: e.userAddress || null,
            profileUrl: e.userAddress ? `https://pump.fun/profile/${e.userAddress}` : null,
            message: typeof e.message === 'string' ? e.message : (Array.isArray(e.message) ? String(e.message[0] || '') : (e.message != null ? String(e.message) : null)),
            timestamp: e.timestamp || null
          };
        }).filter((x) => x.username || x.message);

        setCors(res);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          ok: true,
          mode: 'browser-ws',
          mint,
          fetchedAt: Date.now(),
          listenMs,
          messageCount: normalized.length,
          messages: normalized
        }, null, 2));
      } catch (err) {
        setCors(res);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: err.message }, null, 2));
      }
    })();
    return;
  }

  // Human-friendly chat viewer (polls /chat-scrape)
  if (urlPath === '/render/chat') {
    const mint = reqUrl.searchParams.get('mint') || '';
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Pump.fun Chat Viewer</title>
  <style>
    body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;background:#0b0f14;color:#e6edf3;margin:0}
    header{position:sticky;top:0;background:rgba(11,15,20,.92);backdrop-filter:blur(8px);border-bottom:1px solid #1f2937;padding:12px 16px;display:flex;gap:12px;align-items:center}
    input,button{background:#111827;border:1px solid #1f2937;color:#e6edf3;border-radius:10px;padding:8px 10px}
    button{cursor:pointer}
    .wrap{padding:16px;max-width:1100px;margin:0 auto}
    .grid{display:grid;grid-template-columns:220px 1fr 280px;gap:12px}
    @media (max-width: 980px){.grid{grid-template-columns:1fr}}
    .card{background:#0f172a;border:1px solid #1f2937;border-radius:14px;overflow:hidden}
    .card h3{margin:0;padding:10px 12px;border-bottom:1px solid #1f2937;font-size:13px;letter-spacing:.2px;opacity:.95}
    .card .body{padding:12px}
    .msg{padding:10px 12px;border-top:1px solid rgba(31,41,55,.75)}
    .msg:first-child{border-top:none}
    .row{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
    .user{font-weight:700}
    .wallet{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;opacity:.85}
    .text{margin-top:6px;opacity:.95}
    a{color:#93c5fd;text-decoration:none}
    a:hover{text-decoration:underline}
    .muted{opacity:.75;font-size:12px}
  </style>
</head>
<body>
  <header>
    <div style="font-weight:700">Chat Viewer</div>
    <label class="muted">mint</label>
    <input id="mint" style="width:420px" value="${escapeHtml(mint)}" placeholder="CpqA1pwX5SjU1SgufRwQ59knKGaDMEQ7MQBeu6mpump" />
    <label class="muted">poll ms</label>
    <input id="poll" style="width:100px" value="2000" />
    <button id="go">Start</button>
    <div id="status" class="muted"></div>
  </header>

  <div class="wrap">
    <div class="grid">
      <div class="card">
        <h3>Quick links</h3>
        <div class="body">
          <div class="muted" style="margin-bottom:10px">These use your server-side auth cookie if configured.</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <a id="coinLink" href="#">/render/coin</a>
            <a id="fragLink" href="#">/chat-fragment</a>
            <a id="jsonLink" href="#">/chat-scrape</a>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>Messages</h3>
        <div id="messages"></div>
      </div>

      <div class="card">
        <h3>Debug</h3>
        <div class="body">
          <div class="muted">If you see “chat container not found”, Pump.fun changed markup; we’ll adjust the selector.</div>
          <div id="debug" class="muted" style="margin-top:10px;white-space:pre-wrap"></div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);

    let timer = null;
    async function tick() {
      const mint = $('mint').value.trim();
      if (!mint) return;

      const poll = Math.max(500, Math.min(30000, Number($('poll').value || 2000)));
      const url = '/chat-scrape?mint=' + encodeURIComponent(mint) + '&max=50&wallets=1';
      $('jsonLink').href = url;
      $('fragLink').href = '/chat-fragment?mint=' + encodeURIComponent(mint);
      $('coinLink').href = '/render/coin?mint=' + encodeURIComponent(mint);

      try {
        $('status').textContent = 'fetching...';
        const res = await fetch(url, { cache: 'no-store' });
        const json = await res.json();
        $('debug').textContent = JSON.stringify({ upstreamStatus: json.upstreamStatus, messageCount: json.messageCount, fetchedAt: json.fetchedAt }, null, 2);
        $('status').textContent = json.ok ? ('ok (' + json.messageCount + ')') : 'error';

        const root = $('messages');
        root.innerHTML = '';
        (json.messages || []).slice(-50).reverse().forEach((m) => {
          const div = document.createElement('div');
          div.className = 'msg';
          div.innerHTML = \`
            <div class="row">
              <a class="user" href="\${m.profileUrl}" target="_blank" rel="noreferrer">\${escapeHtml(m.username || '')}</a>
              <span class="wallet">\${escapeHtml(m.wallet || '')}</span>
            </div>
            <div class="text">\${escapeHtml(m.message || '')}</div>
          \`;
          root.appendChild(div);
        });
      } catch (e) {
        $('status').textContent = 'fetch error';
        $('debug').textContent = String(e && e.message ? e.message : e);
      }

      clearTimeout(timer);
      timer = setTimeout(tick, poll);
    }

    function escapeHtml(s) {
      return String(s || '')
        .replaceAll('&','&amp;')
        .replaceAll('<','&lt;')
        .replaceAll('>','&gt;')
        .replaceAll('\"','&quot;')
        .replaceAll(\"'\",'&#39;');
    }

    $('go').addEventListener('click', () => {
      clearTimeout(timer);
      tick();
    });

    // Auto-start if mint provided
    if ($('mint').value.trim()) tick();
  </script>
</body>
</html>`);
    return;
  }

  if (urlPath === '/pump/coin') {
    const mint = reqUrl.searchParams.get('mint');
    if (!mint) {
      setCors(res);
      return sendError(res, 400, 'Missing mint');
    }
    (async () => {
      try {
        const { headers } = buildPumpHeaders({ includeCookie: true });
        const url = `https://frontend-api-v3.pump.fun/coins-v2/${encodeURIComponent(mint)}`;
        const result = await fetchJson(url, { headers });

        const current = readJsonFileSafe(CACHE_PATH) || {};
        current[mint] = { fetchedAt: Date.now(), status: result.status, data: result.json || null };
        writeJsonFileSafe(CACHE_PATH, current);

        setCors(res);
        res.statusCode = result.status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ mint, status: result.status, data: result.json || null }, null, 2));
      } catch (err) {
        setCors(res);
        sendError(res, 500, 'Coin fetch error');
      }
    })();
    return;
  }

  if (urlPath === '/coin-sse') {
    const mint = reqUrl.searchParams.get('mint');
    const intervalMs = Math.max(3000, Math.min(60000, Number(reqUrl.searchParams.get('interval') || 10000)));
    if (!mint) {
      setCors(res);
      return sendError(res, 400, 'Missing mint');
    }

    setSseHeaders(res);
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, mint, intervalMs })}\n\n`);

    let closed = false;
    req.on('close', () => {
      closed = true;
    });

    const tick = async () => {
      if (closed) return;
      try {
        const { headers } = buildPumpHeaders({ includeCookie: true });
        const url = `https://frontend-api-v3.pump.fun/coins-v2/${encodeURIComponent(mint)}`;
        const result = await fetchJson(url, { headers });
        res.write(`data: ${JSON.stringify({ type: 'coin', status: result.status, data: result.json || null })}\n\n`);
      } catch (err) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
      }
      setTimeout(tick, intervalMs);
    };
    tick();
    return;
  }

  if (urlPath === '/chat-sse') {
    const room = reqUrl.searchParams.get('room');
    const commandsOnly = String(reqUrl.searchParams.get('commands') || '0') === '1';
    if (!room) {
      setCors(res);
      return sendError(res, 400, 'Missing room');
    }

    setSseHeaders(res);
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    const { headers: pumpHeaders, jwt } = buildPumpHeaders({ includeCookie: true });
    const viewer = getViewerIdentity(jwt);
    const extraHeaders = { ...pumpHeaders };

    const socket = io('https://livechat.pump.fun', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
      extraHeaders,
      auth: jwt ? { token: jwt, auth_token: jwt, username: viewer.username } : undefined
    });

    const sendEvent = (eventName, payload) => {
      res.write(`data: ${JSON.stringify({ event: eventName, data: payload })}\n\n`);
    };

    const joinRoomCandidates = async (baseRoom) => {
      // Pump.fun chat roomId appears to be the mint itself (plus occasional extracted variants).
      // Keep the candidate list tight to avoid confusing server-side room state.
      const candidates = new Set([baseRoom]);

      // Try to extract room id from Pump.fun HTML
      try {
        const htmlRes = await fetchText(`https://pump.fun/coin/${encodeURIComponent(baseRoom)}`, { headers: pumpHeaders });
        const html = htmlRes.text || '';
        const matches = [
          ...html.matchAll(/"roomId"\s*:\s*"([^"]+)"/gi),
          ...html.matchAll(/"chatRoomId"\s*:\s*"([^"]+)"/gi),
          ...html.matchAll(/"chatRoom"\s*:\s*"([^"]+)"/gi),
          ...html.matchAll(/data-room="([^"]+)"/gi)
        ];
        matches.forEach(match => candidates.add(match[1]));
      } catch (err) {
        sendEvent('debug', { message: 'Room probe failed', error: err.message });
      }

      // Try livechat room config (used by the website)
      try {
        const cfgUrl = `https://livechat.pump.fun/rooms/${encodeURIComponent(baseRoom)}/config/chat`;
        const cfg = await fetchJson(cfgUrl, { headers: pumpHeaders });
        sendEvent('debug', { message: 'chat config', status: cfg.status, json: cfg.json || null });
        if (cfg.json) {
          const str = JSON.stringify(cfg.json);
          const roomMatches = [
            ...str.matchAll(/"roomId"\s*:\s*"([^"]+)"/gi),
            ...str.matchAll(/"room"\s*:\s*"([^"]+)"/gi),
            ...str.matchAll(/"roomName"\s*:\s*"([^"]+)"/gi),
            ...str.matchAll(/"id"\s*:\s*"([^"]+)"/gi)
          ];
          roomMatches.forEach(m => candidates.add(m[1]));
        }
      } catch (err) {
        sendEvent('debug', { message: 'chat config probe failed', error: err.message });
      }

      // Try livestream join (used by the website)
      try {
        const joinUrl = 'https://livestream-api.pump.fun/livestream/join';
        const joinAttempts = [
          { roomName: baseRoom },
          { room: baseRoom },
          { mint: baseRoom }
        ];
        for (const body of joinAttempts) {
          const jr = await postJson(joinUrl, body, { headers: pumpHeaders });
          sendEvent('debug', { message: 'livestream join', body, status: jr.status, json: jr.json || null });
          if (jr.json) {
            const str = JSON.stringify(jr.json);
            const roomMatches = [
              ...str.matchAll(/"roomId"\s*:\s*"([^"]+)"/gi),
              ...str.matchAll(/"room"\s*:\s*"([^"]+)"/gi),
              ...str.matchAll(/"roomName"\s*:\s*"([^"]+)"/gi),
              ...str.matchAll(/"livechat_room"\s*:\s*"([^"]+)"/gi)
            ];
            roomMatches.forEach(m => candidates.add(m[1]));
          }
        }
      } catch (err) {
        sendEvent('debug', { message: 'livestream join probe failed', error: err.message });
      }

      const roomList = Array.from(candidates).filter(Boolean);
      sendEvent('debug', { message: 'Joining rooms', rooms: roomList });
      roomList.forEach((roomId) => {
        // Pump.fun frontend expects: joinRoom({ roomId, username }, ackCb)
        socket.emit('joinRoom', { roomId, username: viewer.username }, (ack) => {
          sendEvent('debug', { message: 'joinRoom ack', roomId, ack });
          // After join ack, request message history for this room (best effort)
          socket.emit('getMessageHistory', { roomId, before: null, limit: 50 }, (history) => {
            sendEvent('history', { roomId, history });
          });
        });
        // Best-effort compatibility with older server variants
        socket.emit('join_room', roomId);
        socket.emit('join', roomId);
        socket.emit('subscribe', { room: roomId });
        socket.emit('subscribe', roomId);
        socket.emit('room', roomId);
        socket.emit('join-room', roomId);
        socket.emit('subscribe_room', roomId);
      });
    };

    socket.on('connect', () => {
      joinRoomCandidates(room);
      sendEvent('joined', { room });
    });

    const emitMaybeCommand = (payload) => {
      try {
        const msg = payload && payload.message;
        const text = typeof msg === 'string' ? msg : (Array.isArray(msg) ? String(msg[0] || '') : (msg != null ? String(msg) : ''));
        const trimmed = (text || '').trim();
        if (!trimmed.startsWith('/')) return;
        const parts = trimmed.slice(1).split(/\s+/).filter(Boolean);
        const cmd = parts[0] || '';
        const args = parts.slice(1);
        sendEvent('command', {
          cmd,
          args,
          text: trimmed,
          userAddress: payload?.userAddress || null,
          username: payload?.username || null,
          id: payload?.id || null,
          timestamp: payload?.timestamp || null,
          raw: payload
        });
      } catch {
        // ignore parsing errors
      }
    };

    // Live chat events observed in Pump.fun frontend bundle
    socket.on('newMessage', (payload) => {
      if (!commandsOnly) sendEvent('newMessage', payload);
      emitMaybeCommand(payload);
    });
    ['messageDeleted', 'messagePinned', 'messageUnpinned', 'messageReactionUpdated', 'userBannedInRoom', 'userUnbannedInRoom', 'userMessagesWiped', 'roomModeratorAssigned', 'roomModeratorUnassigned']
      .forEach((eventName) => socket.on(eventName, (payload) => {
        if (!commandsOnly) sendEvent(eventName, payload);
      }));

    // Legacy / fallback listeners
    socket.on('message', (payload) => sendEvent('message', payload));
    ['chat_message', 'new_message', 'msg', 'room_message', 'chat'].forEach((eventName) => socket.on(eventName, (payload) => sendEvent(eventName, payload)));

    socket.onAny((eventName, payload) => {
      if (['connect', 'disconnect', 'connect_error'].includes(eventName)) return;
      sendEvent('event', { name: eventName, payload });
    });

    socket.on('connect_error', (err) => {
      res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    });

    const keepAlive = setInterval(() => {
      res.write('event: ping\ndata: {}\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      socket.disconnect();
    });

    return;
  }

  // Holder check endpoint
  if (urlPath === '/holder-check') {
    setCors(res);
    if (req.method !== 'GET') {
      return sendError(res, 405, 'Method not allowed');
    }
    (async () => {
      try {
        const wallet = String(reqUrl.searchParams.get('wallet') || '').trim();
        if (!isLikelyBase58Address(wallet)) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: 'Bad wallet' }, null, 2));
          return;
        }
        const MEWVOLT_MINT = 'CpqA1pwX5SjU1SgufRwQ59knKGaDMEQ7MQBeu6mpump';
        const HOLDER_THRESHOLD_USD = 5.0;
        
        const connection = new solanaWeb3.Connection(SOLANA_RPC_URL, 'confirmed');
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
          new solanaWeb3.PublicKey(wallet),
          { mint: new solanaWeb3.PublicKey(MEWVOLT_MINT) }
        );
        
        let balance = 0;
        if (tokenAccounts.value && tokenAccounts.value.length > 0) {
          balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0;
        }
        
        let priceUsd = 0;
        try {
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), 5000);
          const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${MEWVOLT_MINT}`, { signal: ac.signal });
          clearTimeout(t);
          const dexJson = await dexRes.json();
          if (dexJson && dexJson.pairs && dexJson.pairs.length > 0) {
            priceUsd = Number(dexJson.pairs[0].priceUsd) || 0;
          }
        } catch {}
        
        const valueUsd = balance * priceUsd;
        const isHolder = valueUsd >= HOLDER_THRESHOLD_USD;
        
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          ok: true,
          wallet,
          balance,
          priceUsd,
          valueUsd,
          isHolder,
          thresholdUsd: HOLDER_THRESHOLD_USD
        }, null, 2));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: err.message }, null, 2));
      }
    })();
    return;
  }

  // Drive DB endpoints (read/write drive_db.json)
  if (urlPath === '/drive/read') {
    setCors(res);
    if (req.method !== 'GET') {
      return sendError(res, 405, 'Method not allowed');
    }
    const db = readJsonFileSafe(DRIVE_DB_PATH) || defaultDriveDb();
    if (!db.slotState || typeof db.slotState !== 'object') db.slotState = defaultSlotState();
    if (!db.slotState.dailySpins || typeof db.slotState.dailySpins !== 'object') db.slotState.dailySpins = {};
    if (!db.slotState.userPoints || typeof db.slotState.userPoints !== 'object') db.slotState.userPoints = {};
    if (!db.slotState.lastResetDate) db.slotState.lastResetDate = new Date().toDateString();
    if (!db.slotState.jackpot || Number(db.slotState.jackpot) < 1000) db.slotState.jackpot = 1000;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: true, data: db }, null, 2));
    return;
  }

  if (urlPath === '/drive/append') {
    setCors(res);
    if (req.method !== 'POST') {
      return sendError(res, 405, 'Method not allowed');
    }
    (async () => {
      try {
        const body = await readBodyJson(req, { maxBytes: 10_000_000 });
        const db = readJsonFileSafe(DRIVE_DB_PATH) || defaultDriveDb();
        if (!db.slotState || typeof db.slotState !== 'object') db.slotState = defaultSlotState();
        
        // Helper function to check if chat entry already exists by ID (primary check)
        const chatExistsById = (existingChats, id) => {
          if (!id) return false;
          return existingChats.some(c => c.id === id);
        };
        
        // Helper function to check if chat entry already exists (fallback for entries without ID)
        const chatExists = (existingChats, newChat) => {
          // Primary check: by ID (most reliable)
          if (newChat.id && chatExistsById(existingChats, newChat.id)) {
            return true;
          }
          // Fallback: check by ts, username, text, userAddress (within 1 second tolerance)
          return existingChats.some(c => 
            c.username === newChat.username &&
            c.text === newChat.text &&
            c.userAddress === newChat.userAddress &&
            Math.abs((c.ts || 0) - (newChat.ts || 0)) < 1000
          );
        };
        
        // Helper function to check if log entry already exists
        const logExists = (existingLogs, newLog) => {
          return existingLogs.some(l => 
            l.username === newLog.username &&
            l.text === newLog.text &&
            Math.abs((l.ts || 0) - (newLog.ts || 0)) < 1000
          );
        };
        
        // Helper function to check if winner entry already exists
        const winnerExists = (existingWinners, newWinner) => {
          return existingWinners.some(w => 
            w.username === newWinner.username &&
            w.prize === newWinner.prize &&
            w.amount === newWinner.amount &&
            Math.abs((w.ts || 0) - (newWinner.ts || 0)) < 1000
          );
        };
        
        // Append new entries (filter duplicates - prioritize ID check)
        if (Array.isArray(body.chats)) {
          const existingChats = db.chats || [];
          // Create a Set of existing IDs for faster lookup
          const existingIds = new Set((existingChats || []).map(c => c.id).filter(Boolean));
          
          // Filter duplicates: check by ID first, then fallback to other fields
          const newChats = body.chats.filter(newChat => {
            // If has ID, check if ID already exists
            if (newChat.id && existingIds.has(newChat.id)) {
              return false; // Skip - duplicate ID
            }
            // If no ID or ID not found, check by other fields
            return !chatExists(existingChats, newChat);
          });
          
          if (newChats.length > 0) {
            // Add new IDs to the Set and concatenate
            newChats.forEach(c => {
              if (c.id) existingIds.add(c.id);
            });
            db.chats = existingChats.concat(newChats);
          }
        }
        if (Array.isArray(body.logs)) {
          const existingLogs = db.logs || [];
          const newLogs = body.logs.filter(newLog => !logExists(existingLogs, newLog));
          if (newLogs.length > 0) {
            db.logs = existingLogs.concat(newLogs);
          }
        }
        if (Array.isArray(body.winners)) {
          const existingWinners = db.winners || [];
          const newWinners = body.winners.filter(newWinner => !winnerExists(existingWinners, newWinner));
          if (newWinners.length > 0) {
            db.winners = existingWinners.concat(newWinners);
          }
        }

        // Merge slotState (overlay sends full state snapshots)
        if (body.slotState && typeof body.slotState === 'object') {
          const incoming = body.slotState;
          const {
            dailySpins: incomingDailySpins,
            userPoints: incomingUserPoints,
            queue: _ignoredQueue,
            ...rest
          } = incoming;

          db.slotState = { ...db.slotState, ...rest };

          if (incomingDailySpins && typeof incomingDailySpins === 'object') {
            db.slotState.dailySpins = { ...(db.slotState.dailySpins || {}), ...incomingDailySpins };
          }
          if (incomingUserPoints && typeof incomingUserPoints === 'object') {
            db.slotState.userPoints = { ...(db.slotState.userPoints || {}), ...incomingUserPoints };
          }

          if (!db.slotState.lastResetDate) db.slotState.lastResetDate = new Date().toDateString();
          if (!db.slotState.jackpot || Number(db.slotState.jackpot) < 1000) db.slotState.jackpot = 1000;
          if (!db.slotState.dailyNFTCount) db.slotState.dailyNFTCount = 0;
          if (!db.slotState.dailyPurchasesSOL) db.slotState.dailyPurchasesSOL = 0;
          if (!db.slotState.yesterdayPurchasesSOL) db.slotState.yesterdayPurchasesSOL = 0;
        }
        
        // Save back to file
        const saved = writeJsonFileSafe(DRIVE_DB_PATH, db);
        setCors(res);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true, saved }, null, 2));
      } catch (err) {
        setCors(res);
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: err.message }, null, 2));
      }
    })();
    return;
  }

  // Drive DB clear endpoint (limpa todos os registros)
  if (urlPath === '/drive/clear') {
    setCors(res);
    if (req.method !== 'POST' && req.method !== 'GET') {
      return sendError(res, 405, 'Method not allowed');
    }
    (async () => {
      try {
        // Reset to default empty state (mantém slotState padrão)
        const emptyDb = defaultDriveDb();
        const saved = writeJsonFileSafe(DRIVE_DB_PATH, emptyDb);
        setCors(res);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true, saved, message: 'All records cleared' }, null, 2));
      } catch (err) {
        setCors(res);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: err.message }, null, 2));
      }
    })();
    return;
  }

  // Get payout token (para frontend)
  if (urlPath === '/payout-token') {
    setCors(res);
    if (req.method !== 'GET') {
      return sendError(res, 405, 'Method not allowed');
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ 
      ok: true, 
      hasToken: !!PAYOUT_TOKEN,
      token: PAYOUT_TOKEN || null
    }, null, 2));
    return;
  }

  // Payout endpoint
  if (urlPath === '/payout') {
    if (req.method !== 'POST') {
      setCors(res);
      return sendError(res, 405, 'Method not allowed');
    }
    if (!isPayoutAuthorized(req)) {
      setCors(res);
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: 'Forbidden' }, null, 2));
      return;
    }
    (async () => {
      try {
        const body = await readBodyJson(req, { maxBytes: 200_000 });
        const kind = String(body?.kind || '').trim();
        const toWallet = String(body?.toWallet || '').trim();
        if (!isLikelyBase58Address(toWallet)) throw new Error('Bad toWallet');

        if (kind === 'spl') {
          const mint = String(body?.mint || '').trim();
          const amountTokens = Number(body?.amountTokens);
          if (!isLikelyBase58Address(mint)) throw new Error('Bad mint');
          const out = await sendSplToken({ toWallet, mint, amountTokens });
          setCors(res);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: true, kind: 'spl', ...out }, null, 2));
          return;
        }

        throw new Error('Bad kind (expected spl)');
      } catch (err) {
        setCors(res);
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: err.message }, null, 2));
      }
    })();
    return;
  }

  if (urlPath === '/trades-sse') {
    const mint = reqUrl.searchParams.get('mint');
    if (!mint) {
      setCors(res);
      return sendError(res, 400, 'Missing mint');
    }

    setSseHeaders(res);
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    const ws = new WebSocket('wss://pumpportal.fun/api/data');

    ws.on('open', () => {
      ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [mint] }));
    });

    ws.on('message', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'trade', data: data.toString() })}\n\n`);
    });

    ws.on('error', (err) => {
      res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    });

    const keepAlive = setInterval(() => {
      res.write('event: ping\ndata: {}\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      try {
        ws.close();
      } catch {
        // ignore
      }
    });

    return;
  }

  const requestedPath = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = safeJoin(ROOT, requestedPath);

  if (!filePath) {
    return sendError(res, 400, 'Bad request');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats) {
      return sendError(res, 404, 'Not found');
    }

    if (stats.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      return fs.readFile(indexPath, (readErr, data) => {
        if (readErr) {
          return sendError(res, 404, 'Not found');
        }
        res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
        res.end(data);
      });
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        return sendError(res, 500, 'Server error');
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

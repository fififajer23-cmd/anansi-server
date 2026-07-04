// ═══════════════════════════════════════════════════════════════════════════════
//  ANANSI CITY GAME SERVER EMULATOR — Production Ready v2.0
//  Game:  "وكر الأوغاد" (Wild City AR / Anansi City)
//  Engine: C++ NextGenEngine + Lua 5.1 (libcity_ar.so)
//  Protocol: HTTP PUT with XOR(key) + Base64 encrypted JSON body
//  XOR Key: "One ring to rule them all, one ring to find them, one ring to
//            bring them all and in the darkness bind them."
// ═══════════════════════════════════════════════════════════════════════════════

// ──────────────────────────────────────
// 0. ENVIRONMENTAL CONFIGURATION
// ──────────────────────────────────────
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const RESOURCES_DIR = process.env.RESOURCES_DIR || './resources';
const DISABLE_DB = process.env.DISABLE_DB === 'true' || !SUPABASE_URL;

// ──────────────────────────────────────
// 1. IMPORTS
// ──────────────────────────────────────
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────
// 2. XOR ENCRYPTION UTILITIES
// ──────────────────────────────────────
const XOR_KEY = "One ring to rule them all, one ring to find them, one ring to bring them all and in the darkness bind them.";

function xorEncrypt(input) {
  let output = '';
  for (let i = 0; i < input.length; i++) {
    output += String.fromCharCode(
      input.charCodeAt(i) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length)
    );
  }
  return output;
}

function xorDecrypt(input) {
  return xorEncrypt(input); // XOR is symmetric
}

function decryptPutBody(bodyBuffer) {
  try {
    const base64Str = bodyBuffer.toString('utf8').trim();
    const decoded = Buffer.from(base64Str, 'base64');
    const decrypted = xorDecrypt(decoded.toString('binary'));
    return JSON.parse(decrypted);
  } catch (e) {
    return null;
  }
}

function sendEncrypted(res, dataObject) {
  const jsonStr = JSON.stringify(dataObject);
  const encrypted = xorEncrypt(jsonStr);
  const base64Res = Buffer.from(encrypted, 'binary').toString('base64');
  res.status(200)
    .set('Content-Type', 'application/octet-stream')
    .end(base64Res);
}

// ──────────────────────────────────────
// 3. SUPABASE / DATABASE LAYER
// ──────────────────────────────────────
let supabase = null;

async function initDatabase() {
  if (DISABLE_DB) {
    console.log('[DB] Supabase not configured. Running in MEMORY/MOCK mode.');
    return;
  }
  try {
    const { createClient } = require('@supabase/supabase-js');
    if (SUPABASE_SERVICE_KEY) {
      supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    } else if (SUPABASE_ANON_KEY) {
      supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    console.log(`[DB] Supabase initialized: ${SUPABASE_URL}`);
    // Test connection
    const { error } = await supabase.from('players').select('id').limit(1);
    if (error && error.code !== 'PGRST116') {
      console.warn(`[DB] Connection test warning: ${error.message}`);
    } else {
      console.log('[DB] Connection successful.');
    }
  } catch (e) {
    console.warn(`[DB] Failed to init Supabase: ${e.message}. Running in MEMORY mode.`);
    supabase = null;
  }
}

// In-memory fallback store for mock mode
const memoryStore = {
  players: new Map(),
  nextId: 1000001,
  sessions: new Map(),
};

function genUUID() {
  return crypto.randomUUID();
}

function genSessionId() {
  return 'sess-' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}

function makeTimestamp() {
  return Math.floor(Date.now() / 1000);
}

// ──────────────────────────────────────
// 4. DATABASE OPERATIONS (Supabase + Memory fallback)
// ──────────────────────────────────────

async function findOrCreateUser(username, deviceId) {
  const now = makeTimestamp();

  // ▸ Try Supabase
  if (supabase) {
    try {
      // Look up by username or deviceId
      const { data: existing, error: lookupErr } = await supabase
        .from('players')
        .select('*')
        .or(`username.eq.${username},device_id.eq.${deviceId}`)
        .limit(1);

      if (!lookupErr && existing && existing.length > 0) {
        const user = existing[0];
        // Update session
        const sessionToken = genSessionId();
        const authToken = genUUID();
        await supabase
          .from('players')
          .update({
            session_token: sessionToken,
            token: authToken,
            last_login: new Date().toISOString(),
          })
          .eq('id', user.id);

        return {
          isNew: false,
          uid: user.id,
          userId: user.id,
          nickname: user.nickname || user.username,
          level: user.level || 1,
          gold: user.gold || 1000,
          diamond: user.diamond || 100,
          exp: user.exp || 0,
          vip_level: user.vip_level || 0,
          token: authToken,
          session: sessionToken,
        };
      }

      // Create new user
      const sessionToken = genSessionId();
      const authToken = genUUID();
      const { data: newUser, error: createErr } = await supabase
        .from('players')
        .insert({
          username: username || `player_${Date.now()}`,
          nickname: username || `player_${Date.now()}`,
          device_id: deviceId || '',
          level: 1,
          gold: 1000,
          diamond: 100,
          exp: 0,
          vip_level: 0,
          session_token: sessionToken,
          token: authToken,
          last_login: new Date().toISOString(),
        })
        .select()
        .single();

      if (!createErr && newUser) {
        return {
          isNew: true,
          uid: newUser.id,
          userId: newUser.id,
          nickname: newUser.nickname,
          level: 1,
          gold: 1000,
          diamond: 100,
          exp: 0,
          vip_level: 0,
          token: authToken,
          session: sessionToken,
        };
      }
      console.warn(`[DB] Create user error: ${createErr?.message}`);
    } catch (e) {
      console.warn(`[DB] Supabase error: ${e.message}. Falling back to memory.`);
    }
  }

  // ▸ Fallback: In-memory store
  const existingPlayer = [...memoryStore.players.values()].find(
    p => p.username === username || p.deviceId === deviceId
  );

  if (existingPlayer) {
    existingPlayer.sessionToken = genSessionId();
    existingPlayer.authToken = genUUID();
    existingPlayer.lastLogin = now;
    return {
      isNew: false,
      uid: existingPlayer.id,
      userId: existingPlayer.id,
      nickname: existingPlayer.nickname,
      level: existingPlayer.level,
      gold: existingPlayer.gold,
      diamond: existingPlayer.diamond,
      exp: existingPlayer.exp,
      vip_level: existingPlayer.vip_level,
      token: existingPlayer.authToken,
      session: existingPlayer.sessionToken,
    };
  }

  // Create new in-memory player
  const newId = memoryStore.nextId++;
  const sessionToken = genSessionId();
  const authToken = genUUID();
  const newPlayer = {
    id: newId,
    username: username || `player_${newId}`,
    nickname: username || `player_${newId}`,
    deviceId: deviceId || '',
    level: 1,
    gold: 1000,
    diamond: 100,
    exp: 0,
    vip_level: 0,
    sessionToken,
    authToken,
    lastLogin: now,
  };
  memoryStore.players.set(newId, newPlayer);

  return {
    isNew: true,
    uid: newId,
    userId: newId,
    nickname: newPlayer.nickname,
    level: 1,
    gold: 1000,
    diamond: 100,
    exp: 0,
    vip_level: 0,
    token: authToken,
    session: sessionToken,
  };
}

// ──────────────────────────────────────
// 5. DEFAULT DTOs / DATA TEMPLATES
// ──────────────────────────────────────

function buildCheckVersionResponse(reqReviewVer) {
  const now = makeTimestamp();
  return {
    status: 1,
    code: 1,
    msg: 'success',
    command: 'checkversion',
    data: {
      version: 39,
      majorVersion: 1,
      minorVersion: 1,
      reviewVersion: typeof reqReviewVer === 'number' ? reqReviewVer : 38,
      gameVersion: 39,
      isReview: 0,
      'maintenance/check': 0,
      isNew: 0,
      token: genUUID(),
      server_time: now,
      sysTime: now,
      timestamp: now,
      updateurl: '',
      updatesignature: '',
      bugFixed: 0,
      impart: 0,
      impartedAt: 0,
      heartbeat: 30,
      crossPlat: 0,
      android: 1,
      serverIdx: 1,
      cksum: 'dummy',
      adfa: '',
    },
  };
}

function buildServerListResponse(req) {
  const host = req.headers['host']
    ? req.headers['host'].split(':')[0]
    : '127.0.0.1';
  return {
    status: 1,
    code: 0,
    msg: 'success',
    command: 'serverlist',
    data: {
      server_list: [
        {
          serverIdx: 1,
          name: 'مدينة الأوغاد',
          showIdx: 1,
          host: host,
          port: PORT,
          status: 1,
          isNew: 0,
          isHot: 1,
          color: 0,
          activity: 0.85,
          players: 128,
          maxPlayers: 2000,
        },
      ],
      server_time: makeTimestamp(),
      timestamp: makeTimestamp(),
      sysTime: makeTimestamp(),
    },
  };
}

function buildConfigResponse() {
  const now = makeTimestamp();
  return {
    status: 1,
    code: 0,
    msg: 'success',
    command: 'config',
    data: {
      server_time: now,
      timestamp: now,
      sysTime: now,
      heartbeat: 30,
      maintenance: 0,
      force_update: 0,
      update_url: '',
      version: '1.9.9',
      notice: 'مرحبا بك في سيرفر مدينة الأوغاد',
    },
  };
}

// ──────────────────────────────────────
// 6. GAME ENDPOINT HANDLERS (All 76+ CHttpClient commands)
// ──────────────────────────────────────

const COMMAND_HANDLERS = {

  // ── Core System ──
  checkversion: async (req, body) => {
    let reviewVer = 38;
    if (body.command && typeof body.command === 'object') {
      reviewVer = body.command.reviewVersion || 38;
    }
    return buildCheckVersionResponse(reviewVer);
  },

  serverlist: async (req) => {
    return buildServerListResponse(req);
  },
  RequestServerList: async (req) => {
    return buildServerListResponse(req);
  },

  login: async (req, body) => {
    const payload = body.data || body.params || {};
    const username = payload.username || payload.name || 'BazookaTest';
    const deviceId = payload.deviceId || payload.device_id || `dev_${Date.now()}`;
    const user = await findOrCreateUser(username, deviceId);
    const now = makeTimestamp();
    return {
      status: 1,
      code: 0,
      msg: 'success',
      command: 'login',
      data: {
        uid: user.uid,
        userId: user.userId,
        token: user.token,
        session: user.session,
        nickname: user.nickname,
        level: user.level,
        gold: user.gold,
        diamond: user.diamond,
        vip_level: user.vip_level,
        exp: user.exp,
        server_time: now,
        timestamp: now,
        sysTime: now,
        isNew: user.isNew ? 1 : 0,
      },
    };
  },
  PlayerAuth: async (req, body) => COMMAND_HANDLERS.login(req, body),
  PlayerLogin: async (req, body) => COMMAND_HANDLERS.login(req, body),
  GuestRegister: async (req, body) => COMMAND_HANDLERS.login(req, body),
  GuestRegisterPlayerServer: async (req, body) => COMMAND_HANDLERS.login(req, body),

  register: async (req, body) => {
    const payload = body.data || body.params || {};
    const username = payload.username || `new_${Date.now()}`;
    const user = await findOrCreateUser(username, '');
    const now = makeTimestamp();
    return {
      status: 1,
      code: 0,
      msg: 'success',
      command: 'register',
      data: {
        uid: user.uid,
        nickname: user.nickname,
        server_time: now,
      },
    };
  },

  config: async () => buildConfigResponse(),
  getConfig: async () => buildConfigResponse(),

  // ── Player Data ──
  GetPlayerBag: async () => ({
    status: 1, code: 0, msg: 'success', command: 'GetPlayerBag',
    data: { items: [], gold: 0, diamond: 0, capacity: 100 },
  }),
  GetPlayerGoods: async () => ({
    status: 1, code: 0, msg: 'success', command: 'GetPlayerGoods',
    data: { goods: [] },
  }),
  GetPlayerList: async () => ({
    status: 1, code: 0, msg: 'success', command: 'GetPlayerList',
    data: { players: [] },
  }),
  PlayerConnect: async () => ({
    status: 1, code: 0, msg: 'success', command: 'PlayerConnect',
    data: { connected: 1, server_time: makeTimestamp() },
  }),
  PlayerCreate: async (req) => COMMAND_HANDLERS.login(req, {}),
  PlayerRecover: async () => ({
    status: 1, code: 0, msg: 'success', command: 'PlayerRecover',
    data: { recovered: 1 },
  }),

  // ── Equipment & Estate ──
  PlayerEquipment: async () => ({
    status: 1, code: 0, msg: 'success', command: 'PlayerEquipment',
    data: {
      equipment: {
        weapon: null, armor: null, helmet: null, boots: null, ring: null,
      },
      equipment_list: [],
    },
  }),
  BuyPlayerEstate: async () => ({
    status: 1, code: 0, msg: 'success', command: 'BuyPlayerEstate',
    data: { estate_id: 1, purchased: 1, gold: 0, diamond: 0 },
  }),
  StoreBuyGoldTool: async () => ({
    status: 1, code: 0, msg: 'success', command: 'StoreBuyGoldTool',
    data: { tool_id: 1, count: 1, gold: 0 },
  }),

  // ── Progression ──
  MercenaryLevelUp: async () => ({
    status: 1, code: 0, msg: 'success', command: 'MercenaryLevelUp',
    data: { merc_id: 1, level: 1, exp: 0 },
  }),
  FactionSkillLevel: async () => ({
    status: 1, code: 0, msg: 'success', command: 'FactionSkillLevel',
    data: { skill_id: 1, level: 1 },
  }),
  DungeonPassLevel: async () => ({
    status: 1, code: 0, msg: 'success', command: 'DungeonPassLevel',
    data: { dungeon_id: 1, passed: 1, stars: 3, rewards: {} },
  }),
  GoldCure: async () => ({
    status: 1, code: 0, msg: 'success', command: 'GoldCure',
    data: { cured: 1, gold: 0 },
  }),
  GiftMoney: async () => ({
    status: 1, code: 0, msg: 'success', command: 'GiftMoney',
    data: { gifted: 1, gold: 0 },
  }),
  MergeGold: async () => ({
    status: 1, code: 0, msg: 'success', command: 'MergeGold',
    data: { merged: 1, gold: 0 },
  }),

  // ── Payment ──
  VerifyPayment: async () => ({
    status: 1, code: 0, msg: 'success', command: 'VerifyPayment',
    data: { verified: 1, order_id: 'mock_' + Date.now(), diamond: 0 },
  }),
  VerifyVIPPayment: async () => ({
    status: 1, code: 0, msg: 'success', command: 'VerifyVIPPayment',
    data: { verified: 1, vip_level: 1, days: 30 },
  }),

  // ── Social & Events ──
  GetRGPlayerReward: async () => ({
    status: 1, code: 0, msg: 'success', command: 'GetRGPlayerReward',
    data: { rewards: [], race_data: {} },
  }),
  GetAllPlayerRaceData: async () => ({
    status: 1, code: 0, msg: 'success', command: 'GetAllPlayerRaceData',
    data: { races: [] },
  }),
  PlayerLoginOwnCrossPlat: async () => ({
    status: 1, code: 0, msg: 'success', command: 'PlayerLoginOwnCrossPlat',
    data: { cross_plat: 0, server_id: 1 },
  }),

  // ── Generic fallbacks for unknown game commands ──
};

// Generic catch-all for any unrecognized command
function buildUnknownCommandResponse(commandName) {
  return {
    status: 1,
    code: 0,
    msg: 'success',
    command: commandName || 'ok',
    data: {},
  };
}

// ──────────────────────────────────────
// 7. EXPRESS APP SETUP
// ──────────────────────────────────────

const app = express();

// Trust proxy for correct IP detection behind reverse proxies
app.set('trust proxy', true);

// ── 7a. Raw Body Capture (must be before any body parsers) ──
app.use((req, res, next) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    req.rawBody = Buffer.concat(chunks);
    next();
  });
});

// ── 7b. JSON Body Parser (for non-encrypted requests) ──
app.use((req, res, next) => {
  if (req.rawBody && req.rawBody.length > 0) {
    const ct = (req.headers['content-type'] || '').toLowerCase();
    if (ct.includes('application/json') || ct.includes('text/plain')) {
      try {
        req.body = JSON.parse(req.rawBody.toString('utf8'));
      } catch {
        req.body = req.rawBody.toString('utf8');
      }
    } else {
      req.body = req.rawBody;
    }
  } else {
    req.body = req.rawBody || Buffer.from('');
  }
  next();
});

// ── 7c. CORS ──
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'User-Agent'],
  credentials: true,
  maxAge: 86400,
}));
app.options('*', cors());

// ── 7d. Request Logging ──
const requestHistory = [];
const MAX_HISTORY = 50;

app.use((req, res, next) => {
  const startMs = Date.now();
  const timestamp = new Date().toISOString();

  res.on('finish', () => {
    const entry = {
      time: timestamp,
      method: req.method,
      url: req.originalUrl || req.url,
      ip: req.ip,
      status: res.statusCode,
      ms: Date.now() - startMs,
      bytes: req.rawBody ? req.rawBody.length : 0,
    };
    requestHistory.unshift(entry);
    if (requestHistory.length > MAX_HISTORY) requestHistory.pop();

    console.log(
      `[${timestamp.split('T')[1].split('.')[0]}] ${req.method} ${entry.url} ` +
      `→ ${res.statusCode} (${entry.ms}ms, ${entry.bytes}B)`
    );
  });

  next();
});

// ──────────────────────────────────────
// 8. ENCRYPTED PUT COMMAND ROUTER
// ──────────────────────────────────────

app.use('/api', async (req, res, next) => {
  if (req.method !== 'PUT') return next();
  await handleEncryptedPut(req, res);
});

app.use('/', async (req, res, next) => {
  if (req.method !== 'PUT') return next();
  await handleEncryptedPut(req, res);
});

async function handleEncryptedPut(req, res) {
  try {
    const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (bodyBuffer.length === 0) {
      sendEncrypted(res, { status: 1, msg: 'success', data: {} });
      return;
    }

    const decrypted = decryptPutBody(bodyBuffer);
    if (!decrypted) {
      console.log('[PUT] Failed to decrypt body. Raw preview:', bodyBuffer.slice(0, 64).toString('hex'));
      sendEncrypted(res, { status: 1, code: 1, msg: 'success', command: 'ok', data: {} });
      return;
    }

    // Extract command — could be a string or an object
    const rawCommand = decrypted.command;
    let commandName = 'unknown';

    if (typeof rawCommand === 'string') {
      commandName = rawCommand;
    } else if (rawCommand && typeof rawCommand === 'object') {
      // checkversion often comes as { adfa: "...", vercnjeen: "...", reviewVersion: 38 }
      if (rawCommand.adfa || rawCommand.reviewVersion !== undefined) {
        commandName = 'checkversion';
        // Store request-specific version info
        decrypted._requestReviewVer = rawCommand.reviewVersion;
      }
    }

    console.log(`[PUT] Decrypted command: "${commandName}"`);

    // Route to handler
    const handler = COMMAND_HANDLERS[commandName];
    let responseData;

    if (handler) {
      try {
        responseData = await handler(req, decrypted);
      } catch (handlerErr) {
        console.error(`[PUT] Handler error for "${commandName}":`, handlerErr.message);
        responseData = buildUnknownCommandResponse(commandName);
      }
    } else {
      // Try case-insensitive match
      const matchedKey = Object.keys(COMMAND_HANDLERS).find(
        k => k.toLowerCase() === commandName.toLowerCase()
      );
      if (matchedKey) {
        responseData = await COMMAND_HANDLERS[matchedKey](req, decrypted);
      } else {
        console.log(`[PUT] Unknown command: "${commandName}" — returning generic success`);
        responseData = buildUnknownCommandResponse(commandName);
      }
    }

    sendEncrypted(res, responseData);
  } catch (e) {
    console.error('[PUT] Fatal error:', e.message);
    sendEncrypted(res, { status: 1, code: 1, msg: 'success', command: 'ok', data: {} });
  }
}

// ──────────────────────────────────────
// 9. PLAIN JSON ROUTES (GET/POST fallbacks)
// ──────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 1,
    msg: 'Server is running',
    server_time: makeTimestamp(),
    version: '2.0.0',
    mode: DISABLE_DB ? 'memory' : 'supabase',
  });
});

// Checkversion (plain JSON)
app.all(['/checkversion', '/api/checkversion'], (req, res) => {
  res.json(buildCheckVersionResponse(38));
});

// Login (plain JSON)
app.all(['/login', '/api/login', '/user/login', '/account/login', '/auth/login',
  '/player/login', '/api/player/login'], async (req, res) => {
  try {
    const username = req.body?.username || req.query?.username || 'BazookaTest';
    const deviceId = req.body?.deviceId || req.query?.deviceId || `web_${Date.now()}`;
    const user = await findOrCreateUser(username, deviceId);
    const now = makeTimestamp();
    res.json({
      status: 1, code: 0, msg: 'success', command: 'login',
      data: {
        uid: user.uid, userId: user.userId,
        token: user.token, session: user.session,
        nickname: user.nickname, level: user.level,
        gold: user.gold, diamond: user.diamond,
        vip_level: user.vip_level, exp: user.exp,
        server_time: now, timestamp: now, sysTime: now,
        isNew: user.isNew ? 1 : 0,
      },
    });
  } catch (e) {
    console.error('[Login Error]:', e.message);
    res.status(200).json({ status: 1, code: 0, msg: 'success', command: 'login', data: {} });
  }
});

// Config (plain JSON)
app.all(['/config', '/config/get', '/api/config', '/api/config/get',
  '/server/config', '/game/config'], (req, res) => {
  res.json(buildConfigResponse());
});

// Register (plain JSON)
app.all(['/register', '/api/register', '/user/info', '/api/user/info',
  '/player/info'], (req, res) => {
  const now = makeTimestamp();
  res.json({
    status: 1, code: 0, msg: 'success',
    data: { uid: memoryStore.nextId, nickname: 'Player', server_time: now },
  });
});

// Serverlist (plain JSON)
app.all(['/serverlist', '/api/serverlist', '/servers', '/api/servers'], (req, res) => {
  res.json(buildServerListResponse(req));
});

// ──────────────────────────────────────
// 10. ASSET SERVING (S3 Bucket Emulation)
// ──────────────────────────────────────

// Serve from local resources directory
app.use('/anansi-bucket', (req, res) => {
  const relativePath = req.url.split('?')[0];
  const localPath = path.join(RESOURCES_DIR, relativePath);
  const safePath = path.normalize(localPath);

  // Security: ensure the resolved path stays within RESOURCES_DIR
  const resolvedDir = path.resolve(RESOURCES_DIR);
  const resolvedFile = path.resolve(safePath);
  if (!resolvedFile.startsWith(resolvedDir)) {
    return res.status(403).send('Forbidden');
  }

  if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
    return res.sendFile(safePath);
  }

  // Fallback: return empty success for missing assets to prevent game crash
  console.log(`[Assets] Missing: ${relativePath} → returning empty`);
  res.status(200).send('');
});

// Also serve s3.amazonaws.com path redirects
app.use('/s3.amazonaws.com', (req, res) => {
  const relativePath = req.url.replace('/anansi-bucket/', '').replace('/cityen-download/respkg/', '');
  const localPath = path.join(RESOURCES_DIR, relativePath);
  if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
    return res.sendFile(localPath);
  }
  res.status(200).send('');
});

// ──────────────────────────────────────
// 11. ANALYTICS & MISC ENDPOINTS
// ──────────────────────────────────────

// Analytics /logevent
app.all(['/logevent', '/logevent/weightevent', '/logevent/*', '/api/logevent/*',
  '/analytics', '/analytics/*'], (req, res) => {
  // Log but don't process analytics
  if (req.rawBody && req.rawBody.length > 0) {
    const preview = req.rawBody.slice(0, 256).toString('utf8').replace(/[\x00-\x1f]/g, '');
    console.log(`[Analytics] ${req.method} ${req.url}: ${preview.slice(0, 128)}`);
  }
  res.status(200).json({ status: 1, msg: 'success' });
});

// Password reset page
app.all(['/page/pwdreset', '/pwdreset', '/password/reset'], (req, res) => {
  res.status(200).type('html').send(`
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>إعادة تعيين كلمة المرور</title>
    <style>body{font-family:sans-serif;background:#1a1a2e;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
    .card{background:#16213e;padding:2rem;border-radius:10px;text-align:center;max-width:400px}
    input{width:80%;padding:10px;margin:10px 0;border-radius:5px;border:1px solid #0f3460;background:#1a1a2e;color:#fff}
    button{background:#e94560;color:#fff;padding:10px 30px;border:none;border-radius:5px;cursor:pointer}
    </style></head><body>
    <div class="card"><h1>إعادة تعيين كلمة المرور</h1>
    <p>سيرفر محلي - هذه الصفحة للتجربة فقط</p>
    <input type="email" placeholder="البريد الإلكتروني">
    <br><button disabled>إرسال (معطل)</button>
    <p style="font-size:12px;color:#888;">السيرفر المحلي لا يدعم إعادة تعيين كلمة المرور</p>
    </div></body></html>
  `);
});

// Help/FAQ
app.all(['/mobilefaq/helpfaq.html', '/helpfaq', '/faq'], (req, res) => {
  res.status(200).type('html').send(
    '<html><body><h1>مساعدة</h1><p>سيرفر محلي لمدينة الأوغاد</p></body></html>'
  );
});

// ──────────────────────────────────────
// 12. DASHBOARD UI
// ──────────────────────────────────────

app.get('/', (req, res) => {
  const accept = String(req.headers.accept || '');
  const wantsHtml = accept.includes('text/html') || accept.includes('*/*');

  if (!wantsHtml) {
    res.json({
      status: 1,
      msg: 'success',
      server_time: makeTimestamp(),
      mode: DISABLE_DB ? 'memory' : 'supabase',
      requests_served: requestHistory.length,
    });
    return;
  }

  const rows = requestHistory.slice(0, MAX_HISTORY).map(e =>
    `<tr>
      <td>${e.time.split('T')[1].split('.')[0]}</td>
      <td>${e.method}</td>
      <td title="${e.url}">${e.url.length > 40 ? e.url.slice(0, 40) + '…' : e.url}</td>
      <td>${e.ip}</td>
      <td style="color:${e.status < 400 ? '#0f0' : '#f00'}">${e.status}</td>
      <td>${e.ms}ms</td>
      <td>${e.bytes}B</td>
    </tr>`
  ).join('');

  res.send(`<!DOCTYPE html>
<html lang="ar">
<head><meta charset="utf-8">
<title>مدينة الأوغاد — لوحة السيرفر</title>
<style>
*{box-sizing:border-box}
body{font-family:'Courier New',monospace;background:#0d1117;color:#c9d1d9;padding:20px;margin:0}
h1{color:#58a6ff;border-bottom:1px solid #30363d;padding-bottom:10px}
h3{color:#8b949e;margin:0 0 10px 0}
.box{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:16px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.stat{text-align:center;padding:12px;background:#0d1117;border-radius:6px}
.stat-value{font-size:24px;font-weight:bold;color:#58a6ff}
.stat-label{font-size:12px;color:#8b949e;margin-top:4px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:8px 12px;border-bottom:2px solid #30363d;color:#8b949e;font-size:11px;text-transform:uppercase}
td{padding:8px 12px;border-bottom:1px solid #21262d}
tr:hover{background:#1c2128}
.status-ok{color:#3fb950}
.status-warn{color:#d29922}
.note{color:#8b949e;font-size:12px;text-align:center;margin-top:20px}
button{background:#238636;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-family:inherit}
button:hover{background:#2ea043}
pre{background:#0d1117;padding:12px;border-radius:6px;overflow-x:auto;font-size:12px;border:1px solid #30363d}
</style>
</head>
<body>
<h1>🏙️ مدينة الأوغاد — سيرفر اللعبة</h1>

<div class="grid">
  <div class="box" style="grid-column:1/-1">
    <div class="grid">
      <div class="stat"><div class="stat-value">${requestHistory.length}</div><div class="stat-label">الطلبات</div></div>
      <div class="stat"><div class="stat-value">${PORT}</div><div class="stat-label">المنفذ</div></div>
      <div class="stat"><div class="stat-value ${DISABLE_DB ? 'status-warn' : 'status-ok'}">${DISABLE_DB ? 'ذاكرة' : 'Supabase'}</div><div class="stat-label">قاعدة البيانات</div></div>
      <div class="stat"><div class="stat-value">${memoryStore.players.size}</div><div class="stat-label">اللاعبون</div></div>
      <div class="stat"><div class="stat-value">${Object.keys(COMMAND_HANDLERS).length}</div><div class="stat-label">الأوامر المدعومة</div></div>
    </div>
  </div>
</div>

<div class="box">
  <h3>🔧 اختبار الاتصال</h3>
  <button onclick="testEndpoint('/checkversion')">/checkversion</button>
  <button onclick="testEndpoint('/config')">/config</button>
  <button onclick="testEndpoint('/serverlist')">/serverlist</button>
  <button onclick="testEndpoint('/health')">/health</button>
  <button onclick="testLogin()">تسجيل دخول تجريبي</button>
  <pre id="test-output" style="margin-top:10px;display:none"></pre>
</div>

<div class="box">
  <h3>📜 سجل الطلبات (آخر ${Math.min(MAX_HISTORY, requestHistory.length)})</h3>
  <table>
    <thead><tr><th>الوقت</th><th>الطريقة</th><th>المسار</th><th>IP</th><th>الحالة</th><th>الزمن</th><th>الحجم</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#8b949e">لا توجد طلبات بعد</td></tr>'}</tbody>
  </table>
</div>

<div class="box">
  <h3>⚠️ معلومات هامة</h3>
  <ul style="color:#8b949e;font-size:13px;line-height:1.6">
    <li>🔐 التشفير: XOR + Base64 — المفتاح: "One ring to rule them all..."</li>
    <li>📡 البروتوكول: PUT إلى / مع جسم مشفر، أو GET/POST إلى /checkversion</li>
    <li>💾 الذاكرة: ${memoryStore.players.size} لاعب في الذاكرة${DISABLE_DB ? '' : ' + Supabase'}</li>
    <li>🎯 الـ 76 API Endpoint كلها مدعومة مع ردود افتراضية</li>
    <li>📂 الموارد: يتم تقديمها من مجلد ${RESOURCES_DIR}</li>
  </ul>
</div>

<p class="note">Anansi City Server Emulator v2.0 — ${new Date().toISOString()}</p>

<script>
async function testEndpoint(url) {
  const out = document.getElementById('test-output');
  out.style.display = 'block';
  try {
    const r = await fetch(url);
    const d = await r.json();
    out.textContent = JSON.stringify(d, null, 2);
  } catch(e) { out.textContent = 'خطأ: ' + e.message; }
}
async function testLogin() {
  const out = document.getElementById('test-output');
  out.style.display = 'block';
  try {
    const r = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test_' + Date.now(), deviceId: 'web_test' }),
    });
    const d = await r.json();
    out.textContent = JSON.stringify(d, null, 2);
  } catch(e) { out.textContent = 'خطأ: ' + e.message; }
}
</script>
</body></html>`);
});

// ──────────────────────────────────────
// 13. CATCH-ALL & ERROR HANDLING
// ──────────────────────────────────────

// Empty ZIP file for expansion downloader requests
const EMPTY_ZIP = Buffer.from([
  0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

app.use((req, res, next) => {
  // Ignore WPAD
  if (req.url.includes('wpad.dat')) {
    return res.status(404).end();
  }

  // Empty ZIP for expansion files
  if ((req.method === 'GET' || req.method === 'HEAD') &&
      req.path && req.path.toLowerCase().endsWith('.zip')) {
    res.set('Content-Type', 'application/zip');
    return res.send(EMPTY_ZIP);
  }

  next();
});

// 404 / Catch-all for unknown non-PUT routes
app.use((req, res) => {
  if (req.url.includes('wpad.dat')) return res.status(404).end();

  // Return generic success for all game API calls
  res.status(200).json({
    status: 1,
    code: 1,
    msg: 'success',
    data: {},
    command: 'unknown',
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack || err.message);
  res.status(500).json({ status: 0, code: -1, msg: 'Internal server error' });
});

// ──────────────────────────────────────
// 14. SERVER STARTUP
// ──────────────────────────────────────

async function startServer() {
  // Init database
  await initDatabase();

  // Start listening
  const server = app.listen(PORT, HOST, () => {
    const addr = server.address();
    const hostname = addr.family === 'IPv6' ? '[::]' : addr.address;
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║     🏙️  ANANSI CITY SERVER EMULATOR v2.0                ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  📡 Listening:  http://${hostname}:${addr.port}                 ║`);
    console.log(`║  🔐 XOR Key:    "One ring to rule them all..."           ║`);
    console.log(`║  💾 Database:   ${DISABLE_DB ? 'MEMORY MODE' : 'Supabase'}                       ║`);
    console.log(`║  🎯 Commands:   ${Object.keys(COMMAND_HANDLERS).length} handlers                   ║`);
    console.log(`║  📂 Resources:  ${RESOURCES_DIR}                         ║`);
    console.log(`║  🌐 Dashboard:  http://localhost:${addr.port}              ║`);
    console.log('╚══════════════════════════════════════════════════════════╝');
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
    server.close(() => {
      console.log('[Server] Closed. Goodbye.');
      process.exit(0);
    });
    // Force exit after 5s
    setTimeout(() => {
      console.error('[Server] Forced shutdown after timeout.');
      process.exit(1);
    }, 5000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    console.error('[Uncaught]', err.message);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[UnhandledRejection]', reason);
  });

  return server;
}

// ──────────────────────────────────────
// START
// ──────────────────────────────────────
startServer().catch(err => {
  console.error('[FATAL] Failed to start server:', err.message);
  process.exit(1);
});

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const host = process.env.HOST || '0.0.0.0';
const port = parseInt(process.env.PORT || '8080', 10);
const XOR_KEY = "One ring to rule them all, one ring to find them, one ring to bring them all and in the darkness bind them.";
const resourcesDir = path.join(__dirname, 'resources');

const requestHistory = [];
const MAX_HISTORY = 10;

function xorCipher(input) {
    let output = '';
    for (let i = 0; i < input.length; i++) {
        output += String.fromCharCode(input.charCodeAt(i) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length));
    }
    return output;
}

function sendJSON(res, statusCode, data) {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Max-Age': '86400',
    });
    res.end(body);
}

function sendXOREncrypted(res, data) {
    const jsonStr = JSON.stringify(data);
    const encrypted = xorCipher(jsonStr);
    const base64Res = Buffer.from(encrypted, 'binary').toString('base64');
    res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
    });
    res.end(base64Res);
}

function sendHTML(res, html) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
}

function sendFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav', '.zip': 'application/zip', '.txt': 'text/plain',
        '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    fs.readFile(filePath, (err, data) => {
        if (err) { sendJSON(res, 200, ''); return; }
        res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
        res.end(data);
    });
}

function handlePUT(rawBody) {
    // The body is base64-encoded XOR data. Decode first then XOR.
    let decoded = Buffer.from(rawBody.toString('utf8').trim(), 'base64');
    let decrypted = '';
    for (let i = 0; i < decoded.length; i++) {
        decrypted += String.fromCharCode(decoded[i] ^ XOR_KEY.charCodeAt(i % XOR_KEY.length));
    }

    let command = 'unknown';
    try {
        const parsed = JSON.parse(decrypted);
        command = parsed.command || 'unknown';
    } catch (e) {
        // Not valid JSON, use the raw text
    }

    const now = Math.floor(Date.now() / 1000);

    // Build response based on command
    let responseData = { status: 1, msg: 'success' };

    if (command === 'checkversion' || (typeof command === 'object' && command.adfa)) {
        responseData = {
            status: 1, code: 1, msg: 'success',
            data: {
                version: 1, majorVersion: 1, minorVersion: 0,
                reviewVersion: 13, gameVersion: 1, isReview: 0,
                'maintenance/check': 0, isNew: 0,
                token: 'dev-token-abc-123', updateurl: '', updatesignature: '',
                bugFixed: 0, impart: 0, impartedAt: 0,
                heartbeat: 0, crossPlat: 0, android: 1,
                serverIdx: 1, cksum: '', adfa: '',
                server_time: now, sysTime: now, timestamp: now,
            },
            command: 'checkversion',
        };
    } else if (command === 'login') {
        responseData = {
            status: 1, msg: 'success', command: 'login',
            data: {
                uid: 1000001, userId: 1000001, token: 'fake-jwt-token',
                session: 'fake-session', nickname: 'BazookaTest',
                level: 50, gold: 999999, diamond: 99999, vip_level: 10,
                exp: 10000, server_time: now, timestamp: now, sysTime: now, isNew: 0,
            },
        };
    } else {
        responseData = { status: 1, msg: 'success', data: {}, command: 'ok' };
    }

    return { decrypted, command, responseData };
}

function handleRequest(req, res) {
    const url = req.url || '/';
    const method = req.method.toUpperCase();
    const startMs = Date.now();

    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
        const fullBody = Buffer.concat(body);
        const bodyHex = fullBody.length > 0 ? fullBody.toString('hex').slice(0, 300) : '(empty)';
        const bodyUtf8 = fullBody.length > 0 ? fullBody.toString('utf8').slice(0, 300) : '';
        const bodyPreview = bodyUtf8.match(/[ -~]/) ? bodyUtf8 : bodyHex;

        console.log(`[${new Date().toISOString()}] ${method} ${url} [body:${fullBody.length}B]`);

        // CORS preflight
        if (method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
                'Access-Control-Max-Age': '86400',
            });
            res.end();
            return;
        }

        const urlPath = url.split('?')[0].split('#')[0];

        // Handle encrypted PUT / requests from game
        if (method === 'PUT' && (urlPath === '/' || urlPath === '')) {
            try {
                const result = handlePUT(fullBody);
                console.log(`  -> Decrypted command: ${JSON.stringify(result.command).slice(0, 200)}`);
                console.log(`  -> Raw decrypted: ${result.decrypted.slice(0, 300)}`);
                sendXOREncrypted(res, result.responseData);
                requestHistory.unshift({ time: new Date().toISOString(), method, url, status: 200, cmd: typeof result.command === 'object' ? 'checkversion' : result.command, ms: Date.now() - startMs });
            } catch (e) {
                console.log(`  -> Error handling PUT: ${e.message}`);
                sendXOREncrypted(res, { status: 1, msg: 'success', data: {}, command: 'ok' });
            }
            if (requestHistory.length > MAX_HISTORY) requestHistory.pop();
            return;
        }

        // Plain JSON routes
        const routes = [
            { methods: ['GET', 'POST'], patterns: [/^\/checkversion$/, /^\/api\/checkversion$/], handler: (req, res) => sendJSON(res, 200, { status: 1, code: 1, msg: 'success', data: { version: 1, majorVersion: 1, minorVersion: 0, reviewVersion: 1, gameVersion: 1, isReview: 0, 'maintenance/check': 0, isNew: 0, token: 'developer-token-12345', updateurl: '', updatesignature: '', bugFixed: 0, impart: 0, impartedAt: 0, heartbeat: 0, crossPlat: 0, android: 1, serverIdx: 1, cksum: '', adfa: '', server_time: Math.floor(Date.now() / 1000), sysTime: Math.floor(Date.now() / 1000), timestamp: Math.floor(Date.now() / 1000), }, command: 'checkversion' }) },
            { methods: ['GET', 'POST'], patterns: [/^\/login$/, /^\/api\/login$/, /^\/user\/login$/, /^\/account\/login$/, /^\/auth\/login$/], handler: (req, res) => { const now = Math.floor(Date.now() / 1000); sendJSON(res, 200, { status: 1, code: 0, msg: 'success', command: 'login', data: { uid: 1000001, userId: 1000001, token: 'fake-jwt-token-1234567890', session: 'fake-session-1234567890', nickname: 'BazookaTest', level: 50, gold: 999999, diamond: 99999, vip_level: 10, exp: 10000, server_time: now, timestamp: now, sysTime: now, isNew: 0 } }); } },
            { methods: ['GET', 'POST'], patterns: [/^\/config/, /^\/api\/config/, /^\/server\/config/], handler: (req, res) => { const now = Math.floor(Date.now() / 1000); sendJSON(res, 200, { status: 1, code: 0, msg: 'success', command: 'config', data: { server_time: now, timestamp: now, sysTime: now, heartbeat: 30, maintenance: 0, force_update: 0, update_url: '', version: '1.9.9', notice: 'مرحبا بك في السيرفر الخاص' } }); } },
            { methods: ['GET', 'POST'], patterns: [/^\/register$/, /^\/api\/register$/, /^\/user\/info/, /^\/api\/user\/info/], handler: (req, res) => { const now = Math.floor(Date.now() / 1000); sendJSON(res, 200, { status: 1, code: 0, msg: 'success', data: { uid: 1000001, nickname: 'BazookaTest', server_time: now } }); } },
        ];

        for (const route of routes) {
            if (!route.methods.includes(method)) continue;
            for (const pattern of route.patterns) {
                if (pattern.test(urlPath)) {
                    route.handler(req, res);
                    requestHistory.unshift({ time: new Date().toISOString(), method, url, status: res.statusCode || 200, ms: Date.now() - startMs });
                    if (requestHistory.length > MAX_HISTORY) requestHistory.pop();
                    return;
                }
            }
        }

        // /anansi-bucket/* - serve static files
        if (urlPath.startsWith('/anansi-bucket/')) {
            const relativePath = urlPath.replace('/anansi-bucket/', '');
            const localPath = path.join(resourcesDir, relativePath);
            const normalizedPath = path.normalize(localPath);
            if (normalizedPath.startsWith(resourcesDir) && fs.existsSync(normalizedPath)) {
                sendFile(res, normalizedPath);
                return;
            }
            sendJSON(res, 200, '');
            return;
        }

        // Root dashboard
        if (urlPath === '/') {
            const rows = requestHistory.slice(0, MAX_HISTORY).map(e =>
                `<tr><td>${e.time}</td><td>${e.method}</td><td>${e.url}</td><td>${e.cmd || e.status || ''}</td><td>${e.ms || ''}</td></tr>`
            ).join('');
            sendHTML(res, `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Mock Server</title><style>body{font-family:monospace;background:#1e1e1e;color:#00ff00;padding:20px}.box{border:1px solid #00ff00;padding:15px;margin-bottom:20px}h1{color:#fff}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid #333}th{color:#fff}</style></head><body><h1>Anansi Mock Server</h1><div class="box"><p>Listening on port ${port}</p></div><div class="box"><table><thead><tr><th>Time</th><th>Method</th><th>URL</th><th>Command</th><th>ms</th></tr></thead><tbody>${rows || '<tr><td colspan="5">(no requests yet)</td></tr>'}</tbody></table></div></body></html>`);
            return;
        }

        // ZIP files - empty
        if (urlPath.toLowerCase().endsWith('.zip')) {
            const emptyZip = Buffer.from([0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
            res.writeHead(200, { 'Content-Type': 'application/zip' });
            res.end(emptyZip);
            return;
        }

        sendJSON(res, 200, { status: 1, code: 1, msg: 'success', data: {}, command: 'unknown_fallback' });
    }); // end req.on('end')
}

const server = http.createServer(handleRequest);
server.on('error', (e) => {
    console.log(`Server error: ${e.message}`);
});
process.on('uncaughtException', (e) => {
    console.log(`Uncaught: ${e.message}`);
});
server.listen(port, host, () => {
    console.log(`Server listening at http://${host}:${port}`);
    console.log(`XOR key length: ${XOR_KEY.length}`);
});

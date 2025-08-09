// main.ts - Deno Deploy Edge Network Proxy with Message Audit, WxPusher and Encryption

interface ApiSite {
  path: string;
  baseurl: string;
  ratelimit?: number;
  MaxAuditNum?: number;
  BanTimeInterval?: number;
  BanTimeDuration?: number;
  "msg-audit-config"?: {
    AuditPath?: string;
    AuditParameter?: string;
  };
}

interface AuditResponse {
  status: string;
  verdict: string;
  rule_id?: string;
  data?: {
    size?: string;
    today_scan_total?: string;
    match_string?: string;
    descr?: string;
    EngineType?: string;
    "Engine Version"?: string;
  };
}

interface BanRecord {
  count: number;
  firstViolationTime: number;
  bannedUntil?: number;
}

// Encryption configuration
const ENCRYPTION_PASSWORD = Deno.env.get("ENCRYPTION_PASSWORD") || "openai-proxy-secret-key";
const ENCRYPTION_SALT = Deno.env.get("ENCRYPTION_SALT") || "openai-proxy-salt";

// WxPusher configuration from environment
const WXPUSHER_API_URL = Deno.env.get("WXPUSHER_API_URL") || "https://wxpusher.zjiecode.com/api/send/message";
const WXPUSHER_APP_TOKEN = Deno.env.get("WXPUSHER_APP_TOKEN") || "AT_xxx";
const WXPUSHER_UID = Deno.env.get("WXPUSHER_UID") || "UID_xxx";

// Default API sites configuration
const DEFAULT_API_SITES: ApiSite[] = [
  {
    path: "openai",
    baseurl: "https://api.openai.com",
    ratelimit: 0,
    MaxAuditNum: 12,
    BanTimeInterval: 60,
    BanTimeDuration: 60,
    "msg-audit-config": {
      AuditPath: "/v1/chat/completions",
      AuditParameter: "messages"
    }
  }
];

// Constants
const DEFAULT_RATE_LIMIT = 120;
const DEFAULT_AUDIT_PATH = "/v1/chat/completions";
const DEFAULT_AUDIT_PARAMETER = "messages";
const DEFAULT_MAX_AUDIT_NUM = 12;
const DEFAULT_BAN_TIME_INTERVAL = 60;
const DEFAULT_BAN_TIME_DURATION = 60;
const RATE_LIMIT_WINDOW = 60000;
const AUDIT_API_BASE = "https://apiv1.iminbk.com";

// In-memory storage
class MemoryStore {
  private banRecords: Map<string, BanRecord> = new Map();
  private rateLimits: Map<string, { count: number; expireAt: number }> = new Map();
  
  // Ban record methods
  getBanRecord(key: string): BanRecord | null {
    return this.banRecords.get(key) || null;
  }
  
  setBanRecord(key: string, record: BanRecord): void {
    this.banRecords.set(key, record);
  }
  
  deleteBanRecord(key: string): void {
    this.banRecords.delete(key);
  }
  
  getAllBanRecords(): Map<string, BanRecord> {
    return this.banRecords;
  }
  
  // Rate limit methods
  getRateLimit(key: string): { count: number; expireAt: number } | null {
    const record = this.rateLimits.get(key);
    if (record && record.expireAt > Date.now()) {
      return record;
    }
    // Clean up expired record
    if (record) {
      this.rateLimits.delete(key);
    }
    return null;
  }
  
  setRateLimit(key: string, count: number, expireAt: number): void {
    this.rateLimits.set(key, { count, expireAt });
  }
  
  // Cleanup method for expired records
  cleanup(): void {
    const now = Date.now();
    
    // Clean expired ban records
    for (const [key, record] of this.banRecords.entries()) {
      if (record.bannedUntil && record.bannedUntil < now) {
        this.banRecords.delete(key);
      }
    }
    
    // Clean expired rate limits
    for (const [key, record] of this.rateLimits.entries()) {
      if (record.expireAt < now) {
        this.rateLimits.delete(key);
      }
    }
  }
}

// Create a singleton instance
const memoryStore = new MemoryStore();

// Run cleanup every minute
setInterval(() => {
  memoryStore.cleanup();
}, 60000);

// Encryption/Decryption functions
async function deriveKey(password: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  
  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(ENCRYPTION_SALT),
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encrypt(text: string, password: string): Promise<string> {
  try {
    const key = await deriveKey(password);
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedData = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      data
    );
    
    const combined = new Uint8Array(iv.length + encryptedData.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encryptedData), iv.length);
    
    return btoa(String.fromCharCode(...combined));
  } catch (e) {
    console.error("Encryption error:", e);
    throw new Error("Encryption failed");
  }
}

async function decrypt(encryptedText: string, password: string): Promise<string> {
  try {
    const key = await deriveKey(password);
    const combined = Uint8Array.from(atob(encryptedText), c => c.charCodeAt(0));
    
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    
    const decryptedData = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      data
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decryptedData);
  } catch (e) {
    console.error("Decryption error:", e);
    throw new Error("Decryption failed");
  }
}

// HTML pages for encryption/decryption
function getDecryptionPage(): string {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>解密工具</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 40px;
            width: 100%;
            max-width: 500px;
        }
        h1 {
            color: #333;
            margin-bottom: 30px;
            text-align: center;
            font-size: 28px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            color: #555;
            font-weight: 500;
        }
        input, textarea {
            width: 100%;
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 14px;
            transition: border-color 0.3s;
        }
        input:focus, textarea:focus {
            outline: none;
            border-color: #667eea;
        }
        textarea {
            min-height: 120px;
            resize: vertical;
            font-family: 'Courier New', monospace;
        }
        button {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
        }
        button:hover {
            transform: translateY(-2px);
        }
        button:active {
            transform: translateY(0);
        }
        #result {
            margin-top: 20px;
            padding: 15px;
            background: #f5f5f5;
            border-radius: 8px;
            word-wrap: break-word;
            display: none;
        }
        #result.success {
            background: #e8f5e9;
            border: 1px solid #4caf50;
            color: #2e7d32;
        }
        #result.error {
            background: #ffebee;
            border: 1px solid #f44336;
            color: #c62828;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔓 解密工具</h1>
        <div class="form-group">
            <label for="ciphertext">密文</label>
            <textarea id="ciphertext" placeholder="请输入需要解密的密文..."></textarea>
        </div>
        <div class="form-group">
            <label for="password">密码</label>
            <input type="password" id="password" placeholder="请输入解密密码">
        </div>
        <button onclick="handleDecrypt()">解密</button>
        <div id="result"></div>
    </div>

    <script>
        async function handleDecrypt() {
            const ciphertext = document.getElementById('ciphertext').value.trim();
            const password = document.getElementById('password').value;
            const resultDiv = document.getElementById('result');
            
            if (!ciphertext || !password) {
                resultDiv.className = 'error';
                resultDiv.textContent = '请输入密文和密码';
                resultDiv.style.display = 'block';
                return;
            }
            
            try {
                const response = await fetch('/api/decryption', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ciphertext, password })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    resultDiv.className = 'success';
                    resultDiv.innerHTML = '<strong>解密成功：</strong><br>' + data.plaintext;
                } else {
                    resultDiv.className = 'error';
                    resultDiv.textContent = data.error || '解密失败';
                }
                resultDiv.style.display = 'block';
            } catch (e) {
                resultDiv.className = 'error';
                resultDiv.textContent = '请求失败：' + e.message;
                resultDiv.style.display = 'block';
            }
        }
    </script>
</body>
</html>
  `;
}

function getEncryptionPage(): string {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>加密工具</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 40px;
            width: 100%;
            max-width: 500px;
        }
        h1 {
            color: #333;
            margin-bottom: 30px;
            text-align: center;
            font-size: 28px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            color: #555;
            font-weight: 500;
        }
        input, textarea {
            width: 100%;
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 14px;
            transition: border-color 0.3s;
        }
        input:focus, textarea:focus {
            outline: none;
            border-color: #667eea;
        }
        textarea {
            min-height: 120px;
            resize: vertical;
            font-family: 'Courier New', monospace;
        }
        button {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
        }
        button:hover {
            transform: translateY(-2px);
        }
        button:active {
            transform: translateY(0);
        }
        #result {
            margin-top: 20px;
            padding: 15px;
            background: #f5f5f5;
            border-radius: 8px;
            word-wrap: break-word;
            display: none;
        }
        #result.success {
            background: #e8f5e9;
            border: 1px solid #4caf50;
            color: #2e7d32;
        }
        #result.error {
            background: #ffebee;
            border: 1px solid #f44336;
            color: #c62828;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔒 加密工具</h1>
        <div class="form-group">
            <label for="plaintext">明文</label>
            <textarea id="plaintext" placeholder="请输入需要加密的明文..."></textarea>
        </div>
        <div class="form-group">
            <label for="password">密码</label>
            <input type="password" id="password" placeholder="请输入加密密码">
        </div>
        <button onclick="handleEncrypt()">加密</button>
        <div id="result"></div>
    </div>

    <script>
        async function handleEncrypt() {
            const plaintext = document.getElementById('plaintext').value.trim();
            const password = document.getElementById('password').value;
            const resultDiv = document.getElementById('result');
            
            if (!plaintext || !password) {
                resultDiv.className = 'error';
                resultDiv.textContent = '请输入明文和密码';
                resultDiv.style.display = 'block';
                return;
            }
            
            try {
                const response = await fetch('/api/encryption', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ plaintext, password })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    resultDiv.className = 'success';
                    resultDiv.innerHTML = '<strong>加密成功：</strong><br>' + data.ciphertext;
                } else {
                    resultDiv.className = 'error';
                    resultDiv.textContent = data.error || '加密失败';
                }
                resultDiv.style.display = 'block';
            } catch (e) {
                resultDiv.className = 'error';
                resultDiv.textContent = '请求失败：' + e.message;
                resultDiv.style.display = 'block';
            }
        }
    </script>
</body>
</html>
  `;
}

// Get API sites configuration from environment or use default
function getApiSites(): ApiSite[] {
  const envSites = Deno.env.get("API_SITES");
  if (envSites) {
    try {
      return JSON.parse(envSites);
    } catch (e) {
      console.error("Failed to parse api-sites from environment:", e);
    }
  }
  return DEFAULT_API_SITES;
}

// Check if this is a test request
function isTestRequest(body: any, auditParameter: string): boolean {
  try {
    const messages = body[auditParameter];
    if (!Array.isArray(messages) || messages.length !== 1) return false;
    
    const msg = messages[0];
    return msg.role === "user" && msg.content === "hi";
  } catch {
    return false;
  }
}

// Create a mock response for test requests
function createMockResponse(stream: boolean, model: string): Response {
  const responseContent = "Hello, how can I help you today?";
  
  if (stream) {
    const encoder = new TextEncoder();
    const streamData = [
      `data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":${Math.floor(Date.now()/1000)},"model":"${model}","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n`,
      `data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":${Math.floor(Date.now()/1000)},"model":"${model}","choices":[{"index":0,"delta":{"content":"${responseContent}"},"finish_reason":null}]}\n\n`,
      `data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":${Math.floor(Date.now()/1000)},"model":"${model}","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`,
      `data: [DONE]\n\n`
    ];
    
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of streamData) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    });
    
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      }
    });
  } else {
    const response = {
      id: "chatcmpl-test",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: responseContent
        },
        finish_reason: "stop"
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30
      }
    };
    
    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" }
    });
  }
}

// Format messages for HTML display
function formatMessagesForHtml(body: any, auditParameter: string): string {
  try {
    const messages = body[auditParameter];
    if (!Array.isArray(messages)) return "";
    
    return messages
      .map((msg: any) => {
        const role = msg.role || "unknown";
        const content = msg.content || "";
        return `<p><strong>${role}:</strong> ${content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
      })
      .join("<br/>");
  } catch {
    return "";
  }
}

// Send WxPusher notification with encrypted sensitive data
async function sendWxPusherNotification(
  apiUrl: string,
  token: string,
  model: string,
  auditResult: AuditResponse,
  formattedMessages: string,
  baseurl: string
): Promise<void> {
  try {
    // Encrypt sensitive data
    const encryptedToken = token ? await encrypt(token, ENCRYPTION_PASSWORD) : "";
    const encryptedMessages = await encrypt(formattedMessages, ENCRYPTION_PASSWORD);
    
    // Prepare summary (max 20 chars)
    let summary = `站点触发审核拦截告警`;
    if (summary.length > 20) {
      summary = summary.substring(0, 20);
    }
    
    // Prepare content with encrypted data
    const content = `
      <h2 style="color:red;">API站点触发审核拦截</h2>
      <p><strong>API地址：</strong>${apiUrl}</p>
      <p><strong>令牌（已加密）：</strong><code style="word-break:break-all;">${encryptedToken || "无"}</code></p>
      <p><strong>模型：</strong>${model || "未指定"}</p>
      <p><strong>审核结果：</strong>${auditResult.data?.descr || "违规内容"}</p>
      <h3>违规内容（已加密）：</h3>
      <p><code style="word-break:break-all;">${encryptedMessages}</code></p>
      <hr>
      <p style="color:#666;font-size:12px;">使用解密工具查看原文：/decryption</p>
    `;
    
    const payload = {
      appToken: WXPUSHER_APP_TOKEN,
      content: content,
      summary: summary,
      contentType: 2,
      uids: [WXPUSHER_UID],
      verifyPayType: 0
    };
    
    const response = await fetch(WXPUSHER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      console.error("WxPusher notification failed:", await response.text());
    }
  } catch (e) {
    console.error("Error sending WxPusher notification:", e);
  }
}

// Extract and format messages for audit
function extractMessagesForAudit(body: any, auditParameter: string): string {
  try {
    const messages = body[auditParameter];
    if (!Array.isArray(messages)) return "";
    
    const formatted = messages
      .map((msg: any) => {
        if (typeof msg.content === "string") {
          const cleaned = msg.content
            .replace(/[\n\r\t]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 500);
          return `${msg.role}:${cleaned}`;
        }
        return "";
      })
      .filter(Boolean)
      .join(",");
    
    return formatted;
  } catch (e) {
    console.error("Error extracting messages:", e);
    return "";
  }
}

// Perform message audit
async function auditMessage(message: string): Promise<AuditResponse | null> {
  try {
    let auditUrl: string;
    
    if (/[^\x00-\x7F]/.test(message) || message.length > 200) {
      const base64Message = btoa(unescape(encodeURIComponent(message)));
      auditUrl = `${AUDIT_API_BASE}/base64?word=${base64Message}`;
    } else {
      auditUrl = `${AUDIT_API_BASE}/?word=${encodeURIComponent(message)}`;
    }
    
    const response = await fetch(auditUrl, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });
    
    if (!response.ok) {
      console.error(`Audit API returned status ${response.status}`);
      return null;
    }
    
    return await response.json();
  } catch (e) {
    console.error("Audit API error:", e);
    return null;
  }
}

// Check and update ban status (using memory store)
async function checkAndUpdateBanStatus(
  baseurl: string,
  token: string,
  maxAuditNum: number,
  banTimeInterval: number,
  banTimeDuration: number
): Promise<{ isBanned: boolean; violationCount: number }> {
  if (maxAuditNum === 0) {
    return { isBanned: false, violationCount: 0 };
  }
  
  const now = Date.now();
  const banKey = `ban:${baseurl}:${token}`;
  
  try {
    // Clean up expired ban records
    memoryStore.cleanup();
    
    // Get current ban record
    let record = memoryStore.getBanRecord(banKey);
    
    if (record) {
      if (record.bannedUntil && record.bannedUntil > now) {
        return { isBanned: true, violationCount: record.count };
      }
      
      if (now - record.firstViolationTime > banTimeInterval * 60 * 1000) {
        record = null;
      }
    }
    
    if (!record) {
      record = {
        count: 1,
        firstViolationTime: now
      };
    } else {
      record.count++;
    }
    
    if (record.count >= maxAuditNum) {
      record.bannedUntil = now + (banTimeDuration * 60 * 1000);
      memoryStore.setBanRecord(banKey, record);
      return { isBanned: true, violationCount: record.count };
    }
    
    memoryStore.setBanRecord(banKey, record);
    return { isBanned: false, violationCount: record.count };
    
  } catch (e) {
    console.error("Ban status check error:", e);
    return { isBanned: false, violationCount: 0 };
  }
}

// Check if token is currently banned (using memory store)
async function isTokenBanned(baseurl: string, token: string): Promise<{ banned: boolean; remainingMinutes?: number }> {
  const now = Date.now();
  const banKey = `ban:${baseurl}:${token}`;
  
  try {
    const record = memoryStore.getBanRecord(banKey);
    if (record && record.bannedUntil && record.bannedUntil > now) {
      const remainingMinutes = Math.ceil((record.bannedUntil - now) / 60000);
      return { banned: true, remainingMinutes };
    }
    return { banned: false };
  } catch {
    return { banned: false };
  }
}

// Rate limiting using memory store
async function checkRateLimit(baseurl: string, limit: number): Promise<boolean> {
  if (limit === 0) return true;
  
  const now = Date.now();
  const key = `ratelimit:${baseurl}`;
  
  try {
    const record = memoryStore.getRateLimit(key);
    const currentCount = record ? record.count : 0;
    
    if (currentCount >= limit) {
      return false;
    }
    
    memoryStore.setRateLimit(key, currentCount + 1, now + RATE_LIMIT_WINDOW);
    return true;
  } catch (e) {
    console.error("Rate limit check error:", e);
    return true;
  }
}

// Create error response in OpenAI format
function createErrorResponse(status: number, message: string, type?: string, param?: string, code?: string): Response {
  const error: any = {
    error: {
      message: message || "Request blocked",
      type: type || "invalid_request_error"
    }
  };
  
  if (param) error.error.param = param;
  if (code) error.error.code = code;
  
  return new Response(JSON.stringify(error), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

// Forward request to target
async function forwardRequest(request: Request, targetUrl: string): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.delete("host");
  
  const forwardReq = new Request(targetUrl, {
    method: request.method,
    headers: headers,
    body: request.body
  });
  
  return await fetch(forwardReq);
}

// Main request handler
async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  
  // Root endpoint
  if (url.pathname === "/" && request.method === "GET") {
    return new Response(JSON.stringify({
      status: "ok",
      message: "Openai-compatible Message Audit API Running..."
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  
  // Decryption page
  if (url.pathname === "/decryption" && request.method === "GET") {
    return new Response(getDecryptionPage(), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
  
  // Encryption page
  if (url.pathname === "/encryption" && request.method === "GET") {
    return new Response(getEncryptionPage(), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
  
  // Decryption API
  if (url.pathname === "/api/decryption" && request.method === "POST") {
    try {
      const body = await request.json();
      const { ciphertext, password } = body;
      
      if (!ciphertext || !password) {
        return new Response(JSON.stringify({ error: "密文和密码不能为空" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      
      if (password !== ENCRYPTION_PASSWORD) {
        return new Response(JSON.stringify({ error: "密码错误，解密失败" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }
      
      const plaintext = await decrypt(ciphertext, ENCRYPTION_PASSWORD);
      return new Response(JSON.stringify({ plaintext }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: "解密失败：" + e.message }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  
  // Encryption API
  if (url.pathname === "/api/encryption" && request.method === "POST") {
    try {
      const body = await request.json();
      const { plaintext, password } = body;
      
      if (!plaintext || !password) {
        return new Response(JSON.stringify({ error: "明文和密码不能为空" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      
      if (password !== ENCRYPTION_PASSWORD) {
        return new Response(JSON.stringify({ error: "密码错误，无权限进行加密" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }
      
      const ciphertext = await encrypt(plaintext, ENCRYPTION_PASSWORD);
      return new Response(JSON.stringify({ ciphertext }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: "加密失败：" + e.message }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  
  // Proxy endpoints
  if (!url.pathname.startsWith("/proxy/")) {
    return createErrorResponse(404, "Not found");
  }
  
  const proxyPath = url.pathname.substring(7);
  
  let baseurl: string;
  let targetPath: string;
  let rateLimit: number = DEFAULT_RATE_LIMIT;
  let auditPath: string = DEFAULT_AUDIT_PATH;
  let auditParameter: string = DEFAULT_AUDIT_PARAMETER;
  let maxAuditNum: number = DEFAULT_MAX_AUDIT_NUM;
  let banTimeInterval: number = DEFAULT_BAN_TIME_INTERVAL;
  let banTimeDuration: number = DEFAULT_BAN_TIME_DURATION;
  
  if (proxyPath.startsWith("http://") || proxyPath.startsWith("https://")) {
    const urlMatch = proxyPath.match(/^(https?:\/\/[^\/]+)(\/.*)?$/);
    if (!urlMatch) {
      return createErrorResponse(400, "Invalid proxy URL");
    }
    
    baseurl = urlMatch[1];
    targetPath = urlMatch[2] || "/";
  } else {
    const pathParts = proxyPath.split("/");
    const sitePath = pathParts[0];
    targetPath = "/" + pathParts.slice(1).join("/");
    
    const apiSites = getApiSites();
    const site = apiSites.find(s => s.path === sitePath);
    
    if (!site) {
      return createErrorResponse(404, `API site '${sitePath}' not found`);
    }
    
    baseurl = site.baseurl;
    rateLimit = site.ratelimit ?? DEFAULT_RATE_LIMIT;
    maxAuditNum = site.MaxAuditNum ?? DEFAULT_MAX_AUDIT_NUM;
    banTimeInterval = site.BanTimeInterval ?? DEFAULT_BAN_TIME_INTERVAL;
    banTimeDuration = site.BanTimeDuration ?? DEFAULT_BAN_TIME_DURATION;
    
    if (site["msg-audit-config"]) {
      auditPath = site["msg-audit-config"].AuditPath || DEFAULT_AUDIT_PATH;
      auditParameter = site["msg-audit-config"].AuditParameter || DEFAULT_AUDIT_PARAMETER;
    }
  }
  
  // Extract token from Authorization header
  const authHeader = request.headers.get("Authorization");
  const token = authHeader ? authHeader.replace("Bearer ", "") : "";
  
  // Check if token is banned
  const banStatus = await isTokenBanned(baseurl, token);
  if (banStatus.banned) {
    return createErrorResponse(
      403,
      `因在${banTimeInterval}分钟内触发${maxAuditNum}次违规，已暂时被封禁${banTimeDuration}分钟，请稍后再试。剩余封禁时间：${banStatus.remainingMinutes}分钟`,
      "access_denied"
    );
  }
  
  const rateLimitOk = await checkRateLimit(baseurl, rateLimit);
  if (!rateLimitOk) {
    return createErrorResponse(429, "Rate limit exceeded. Please try again later.", "rate_limit_error");
  }
  
  const targetUrl = baseurl + targetPath;
  
  if (targetPath === auditPath && request.method === "POST") {
    try {
      const bodyText = await request.text();
      const body = JSON.parse(bodyText);
      
      // Check if this is a test request
      if (isTestRequest(body, auditParameter)) {
        return createMockResponse(body.stream === true, body.model ? body.model : "model");
      }
      
      const messagesToAudit = extractMessagesForAudit(body, auditParameter);
      
      if (messagesToAudit) {
        const auditResult = await auditMessage(messagesToAudit);
        
        if (auditResult) {
          if (auditResult.status === "done" && auditResult.verdict === "malicious") {
            // Update ban status
            const { isBanned, violationCount } = await checkAndUpdateBanStatus(
              baseurl,
              token,
              maxAuditNum,
              banTimeInterval,
              banTimeDuration
            );
            
            // Send WxPusher notification with encrypted data
            const formattedMessages = formatMessagesForHtml(body, auditParameter);
            await sendWxPusherNotification(
              targetUrl,
              token,
              body.model,
              auditResult,
              formattedMessages,
              baseurl
            );
            
            if (isBanned) {
              return createErrorResponse(
                403,
                `因在${banTimeInterval}分钟内触发${maxAuditNum}次违规，已暂时被封禁${banTimeDuration}分钟，请稍后再试。`,
                "access_denied"
              );
            } else {
              return createErrorResponse(
                403,
                `${auditResult.data?.descr || "Content blocked by security policy"}。当前违规次数：${violationCount}/${maxAuditNum}`,
                auditResult.verdict,
                auditResult.data?.match_string,
                auditResult.rule_id
              );
            }
          }
        } else {
          console.error("Audit API failed, allowing request");
        }
      }
      
      const forwardReq = new Request(targetUrl, {
        method: request.method,
        headers: request.headers,
        body: bodyText
      });
      
      return await fetch(forwardReq);
    } catch (e) {
      console.error("Error processing chat request:", e);
      return createErrorResponse(500, "Internal server error");
    }
  }
  
  return await forwardRequest(request, targetUrl);
}

// Deno Deploy entry point
Deno.serve(handleRequest);

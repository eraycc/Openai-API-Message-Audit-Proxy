// main.ts - Deno Deploy Edge Network Proxy with Message Audit

interface ApiSite {
  path: string;
  baseurl: string;
  ratelimit?: number;
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

// Default API sites configuration
const DEFAULT_API_SITES: ApiSite[] = [
  {
    path: "openai",
    baseurl: "https://api.openai.com",
    ratelimit: 0,
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
const RATE_LIMIT_WINDOW = 60000; // 1 minute in milliseconds
const AUDIT_API_BASE = "https://apiv1.iminbk.com";

// Memory storage for rate limiting
const rateLimitStore = new Map<string, { count: number; expiresAt: number }>();

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

// Extract and format messages for audit
function extractMessagesForAudit(body: any, auditParameter: string): string {
  try {
    const messages = body[auditParameter];
    if (!Array.isArray(messages)) return "";
    
    // Format messages: role:content pairs
    const formatted = messages
      .map((msg: any) => {
        if (typeof msg.content === "string") {
          // Filter out excessive non-text symbols and trim
          const cleaned = msg.content
            .replace(/[\n\r\t]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 500); // Limit length for audit
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
    // Decide whether to use base64 or URL encoding based on content
    let auditUrl: string;
    
    // Check if message contains special characters that might break URL
    if (/[^\x00-\x7F]/.test(message) || message.length > 200) {
      // Use base64 for non-ASCII or long messages
      const base64Message = btoa(unescape(encodeURIComponent(message)));
      auditUrl = `${AUDIT_API_BASE}/base64?word=${base64Message}`;
    } else {
      // Use URL encoding for simple messages
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

// Rate limiting using memory storage
async function checkRateLimit(baseurl: string, limit: number): Promise<boolean> {
  if (limit === 0) return true; // No limit
  
  const now = Date.now();
  const key = baseurl;
  
  // Clean up expired entries
  const entry = rateLimitStore.get(key);
  if (entry && entry.expiresAt < now) {
    rateLimitStore.delete(key);
  }
  
  // Get current count or initialize
  const currentEntry = rateLimitStore.get(key) || { count: 0, expiresAt: now + RATE_LIMIT_WINDOW };
  
  if (currentEntry.count >= limit) {
    return false; // Rate limit exceeded
  }
  
  // Increment count
  rateLimitStore.set(key, {
    count: currentEntry.count + 1,
    expiresAt: currentEntry.expiresAt
  });
  
  return true;
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
  
  // Remove host header to avoid conflicts
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
  
  // Handle root path
  if (url.pathname === "/" && request.method === "GET") {
    return new Response(JSON.stringify({
      status: "ok",
      message: "Openai-compatible Message Audit API Running..."
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  
  // Check if this is a proxy request
  if (!url.pathname.startsWith("/proxy/")) {
    return createErrorResponse(404, "Not found");
  }
  
  // Extract proxy path
  const proxyPath = url.pathname.substring(7); // Remove "/proxy/"
  
  let baseurl: string;
  let targetPath: string;
  let rateLimit: number = DEFAULT_RATE_LIMIT;
  let auditPath: string = DEFAULT_AUDIT_PATH;
  let auditParameter: string = DEFAULT_AUDIT_PARAMETER;
  
  // Check if it's a direct URL proxy
  if (proxyPath.startsWith("http://") || proxyPath.startsWith("https://")) {
    // Direct URL proxy: /proxy/https://api.example.com/paths
    const urlMatch = proxyPath.match(/^(https?:\/\/[^\/]+)(\/.*)?$/);
    if (!urlMatch) {
      return createErrorResponse(400, "Invalid proxy URL");
    }
    
    baseurl = urlMatch[1];
    targetPath = urlMatch[2] || "/";
    // Use default rate limit for direct proxies
  } else {
    // Path-based proxy: /proxy/openai/paths
    const pathParts = proxyPath.split("/");
    const sitePath = pathParts[0];
    targetPath = "/" + pathParts.slice(1).join("/");
    
    // Find matching API site
    const apiSites = getApiSites();
    const site = apiSites.find(s => s.path === sitePath);
    
    if (!site) {
      return createErrorResponse(404, `API site '${sitePath}' not found`);
    }
    
    baseurl = site.baseurl;
    rateLimit = site.ratelimit ?? DEFAULT_RATE_LIMIT;
    
    if (site["msg-audit-config"]) {
      auditPath = site["msg-audit-config"].AuditPath || DEFAULT_AUDIT_PATH;
      auditParameter = site["msg-audit-config"].AuditParameter || DEFAULT_AUDIT_PARAMETER;
    }
  }
  
  // Check rate limit
  const rateLimitOk = await checkRateLimit(baseurl, rateLimit);
  if (!rateLimitOk) {
    return createErrorResponse(429, "Rate limit exceeded. Please try again later.", "rate_limit_error");
  }
  
  // Build target URL
  const targetUrl = baseurl + targetPath;
  
  // Check if this is a chat completion request that needs audit
  if (targetPath === auditPath && request.method === "POST") {
    try {
      // Clone request to read body
      const bodyText = await request.text();
      const body = JSON.parse(bodyText);
      
      // Extract messages for audit
      const messagesToAudit = extractMessagesForAudit(body, auditParameter);
      
      if (messagesToAudit) {
        // Perform audit
        const auditResult = await auditMessage(messagesToAudit);
        
        if (auditResult) {
          if (auditResult.status === "done") {
            if (auditResult.verdict === "malicious") {
              // Block malicious content
              return createErrorResponse(
                403,
                auditResult.data?.descr || "Content blocked by security policy",
                auditResult.verdict,
                auditResult.data?.match_string,
                auditResult.rule_id
              );
            }
            // verdict === "security", allow request
          } else {
            // Audit failed, log and allow (fail open)
            console.error("Audit API returned non-done status:", auditResult);
          }
        } else {
          // Audit API error, log and allow (fail open)
          console.error("Audit API failed, allowing request");
        }
      }
      
      // Forward request with original body
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
  
  // For non-chat requests, forward directly
  return await forwardRequest(request, targetUrl);
}

// Deno Deploy entry point
Deno.serve(handleRequest);

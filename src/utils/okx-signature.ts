import crypto from "crypto";

/**
 * OKX API Authentication utilities
 * Implements the signature mechanism required for OKX X402 API
 */

export interface OKXCredentials {
  apiKey: string;
  secretKey: string;
  passphrase: string;
}

/**
 * Generate OKX API signature headers
 * @param method HTTP method (GET, POST, etc.)
 * @param requestPath API path (e.g., /api/v6/x402/verify)
 * @param body Request body as string (empty string for GET requests)
 * @param credentials OKX API credentials
 * @returns Headers object with authentication headers
 */
export function generateOKXHeaders(
  method: string,
  requestPath: string,
  body: string,
  credentials: OKXCredentials
): Record<string, string> {
  // Generate ISO timestamp
  const timestamp = new Date().toISOString();

  // Prepare the prehash string: timestamp + method + requestPath + body
  const prehashString = timestamp + method.toUpperCase() + requestPath + body;

  // Generate signature using HMAC SHA256
  const signature = crypto
    .createHmac("sha256", credentials.secretKey)
    .update(prehashString)
    .digest("base64");

  // Return headers
  return {
    "Content-Type": "application/json",
    "OK-ACCESS-KEY": credentials.apiKey,
    "OK-ACCESS-SIGN": signature,
    "OK-ACCESS-PASSPHRASE": credentials.passphrase,
    "OK-ACCESS-TIMESTAMP": timestamp,
  };
}

/**
 * Make authenticated request to OKX API
 * @param url Full URL to request
 * @param method HTTP method
 * @param requestPath API path (without base URL)
 * @param body Request body object (will be JSON stringified)
 * @param credentials OKX API credentials
 * @returns Response from OKX API
 */
export async function makeOKXRequest(
  url: string,
  method: string,
  requestPath: string,
  body: any,
  credentials: OKXCredentials
): Promise<Response> {
  const bodyString = method.toUpperCase() === "GET" ? "" : JSON.stringify(body);
  const headers = generateOKXHeaders(method, requestPath, bodyString, credentials);

  const options: RequestInit = {
    method: method.toUpperCase(),
    headers,
  };

  if (method.toUpperCase() !== "GET" && bodyString) {
    options.body = bodyString;
  }

  // Log request details
  console.log("\n🔵 OKX API Request:");
  console.log(`URL: ${method.toUpperCase()} ${url}`);
  console.log("Headers:", JSON.stringify(headers, null, 2));
  console.log("Body:", bodyString.substring(0, 500) + (bodyString.length > 500 ? "..." : ""));

  const response = await fetch(url, options);

  // Log response details
  console.log("\n🟢 OKX API Response:");
  console.log(`Status: ${response.status} ${response.statusText}`);
  console.log("Headers:", JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2));

  return response;
}

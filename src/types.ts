import { OKXCredentials } from "./utils/okx-signature.js";
import { z } from "zod";

/**
 * Payment configuration for a single network
 */
export interface PaymentConfig {
  price: string;              // Price in USDC (e.g., "0.001")
  chainId: number;           // Network chain ID
  token: string;             // USDC token contract address
  usdcName: string;          // USDC contract name (for EIP-712)
  usdcVersion: string;       // USDC contract version (for EIP-712)
  network: string;           // Network name (e.g., "xlayer", "base-sepolia")
  config?: {
    description?: string;
    metadata?: Record<string, any>;
  };
}

/**
 * Facilitator configuration
 */
export interface FacilitatorConfig {
  url: string;
  type?: "okx" | "standard";
  okxCredentials?: OKXCredentials;
}

/**
 * Server configuration
 */
export interface ServerConfig {
  recipient: string;                                    // Seller wallet address
  facilitators: { [network: string]: FacilitatorConfig };  // Facilitator per network
}

/**
 * Payment requirements in x402 format
 */
export interface PaymentRequirements {
  scheme: "exact";
  network?: string;  // Not used for OKX
  maxAmountRequired: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds: number;
  resource: string;
  mimeType: string;
  description: string;
  extra: {
    name: string;
    version: string;
  };
}

/**
 * Tool method callback type
 */
export type ToolCallback<T extends z.ZodTypeAny> = (
  args: z.infer<T>,
  extra?: any
) => Promise<ToolResult>;

/**
 * Tool result
 */
export interface ToolResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
  _meta?: Record<string, any>;
}

/**
 * Server methods exposed by createPaidMcpHandler
 */
export interface PaidMcpServer {
  paidTool<T extends z.ZodTypeAny>(
    name: string,
    description: string,
    paymentOptions: { payments: PaymentConfig[] },
    paramsSchema: T,
    callback: ToolCallback<T>
  ): void;

  tool<T extends z.ZodTypeAny>(
    name: string,
    description: string,
    paramsSchema: T,
    callback: ToolCallback<T>
  ): void;
}

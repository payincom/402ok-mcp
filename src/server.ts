import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { PaymentConfig, ServerConfig, ToolCallback, PaidMcpServer, PaymentRequirements, ToolResult } from "./types.js";
import { callFacilitator } from "./utils/facilitator.js";

interface ToolDefinition {
  name: string;
  description: string;
  paramsSchema: z.ZodTypeAny;
  callback: ToolCallback<any>;
  paymentOptions?: { payments: PaymentConfig[] };
}

/**
 * Create a paid MCP handler with support for XLayer/OKX and standard facilitators
 */
export function createPaidMcpHandler(
  setupTools: (server: PaidMcpServer) => void,
  serverInfo: { name: string; version: string },
  config: ServerConfig
) {
  const tools: ToolDefinition[] = [];

  // Create server instance
  const server = new Server(
    {
      name: serverInfo.name,
      version: serverInfo.version,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Define server methods
  const mcpServer: PaidMcpServer = {
    paidTool<T extends z.ZodTypeAny>(
      name: string,
      description: string,
      paymentOptions: { payments: PaymentConfig[] },
      paramsSchema: T,
      callback: ToolCallback<T>
    ) {
      tools.push({
        name,
        description,
        paramsSchema,
        callback,
        paymentOptions,
      });
    },

    tool<T extends z.ZodTypeAny>(
      name: string,
      description: string,
      paramsSchema: T,
      callback: ToolCallback<T>
    ) {
      tools.push({
        name,
        description,
        paramsSchema,
        callback,
      });
    },
  };

  // Call setup function to register tools
  setupTools(mcpServer);

  // Helper function to convert Zod schema to JSON Schema
  const zodToJsonSchema = (zodType: any): any => {
    if (zodType instanceof z.ZodString) {
      return { type: "string" };
    }
    if (zodType instanceof z.ZodNumber) {
      return { type: "number" };
    }
    if (zodType instanceof z.ZodBoolean) {
      return { type: "boolean" };
    }
    if (zodType instanceof z.ZodArray) {
      return {
        type: "array",
        items: zodToJsonSchema(zodType._def.type),
      };
    }
    if (zodType instanceof z.ZodObject) {
      const shape = zodType.shape;
      const properties: any = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value);
        // Check if field is required (not optional)
        if (!(value instanceof z.ZodOptional)) {
          required.push(key);
        }
      }

      return {
        type: "object",
        properties,
        required,
      };
    }
    if (zodType instanceof z.ZodEnum) {
      return {
        type: "string",
        enum: zodType._def.values,
      };
    }
    if (zodType instanceof z.ZodOptional) {
      return zodToJsonSchema(zodType._def.innerType);
    }
    // Default fallback
    return { type: "string" };
  };

  // Handle tools/list
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((tool) => {
        let inputSchema: any;

        if (tool.paramsSchema instanceof z.ZodObject) {
          const shape = tool.paramsSchema.shape;
          const properties: any = {};
          const required: string[] = [];

          for (const [key, value] of Object.entries(shape)) {
            properties[key] = zodToJsonSchema(value);
            // Check if field is required (not optional)
            if (!(value instanceof z.ZodOptional)) {
              required.push(key);
            }
          }

          inputSchema = {
            type: "object",
            properties,
            required,
          };
        } else {
          inputSchema = {
            type: "object",
            properties: {},
            required: [],
          };
        }

        return {
          name: tool.name,
          description: tool.description,
          inputSchema,
        };
      }),
    };
  });

  // Handle tools/call
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const toolDef = tools.find((t) => t.name === toolName);

    if (!toolDef) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    // If tool is free, execute directly
    if (!toolDef.paymentOptions) {
      const args = toolDef.paramsSchema.parse(request.params.arguments);
      const result = await toolDef.callback(args, request.params._meta);
      return result;
    }

    // Paid tool - check payment
    const payment = request.params._meta?.["x402.payment"];
    const paymentConfigs = toolDef.paymentOptions.payments;

    if (!payment) {
      // No payment provided - return 402 error with payment options
      const accepts = paymentConfigs.map((cfg) => {
        const priceInSmallestUnit = Math.floor(parseFloat(cfg.price) * 1_000_000).toString();

        return {
          scheme: "exact" as const,
          network: cfg.network,
          maxAmountRequired: priceInSmallestUnit,
          payTo: config.recipient,
          asset: cfg.token,
          maxTimeoutSeconds: 300,
          resource: `${process.env.URL || "http://localhost:3000"}/mcp/tools/${toolName}`,
          mimeType: "application/json",
          description: cfg.config?.description || toolDef.description,
          extra: {
            name: cfg.usdcName,
            version: cfg.usdcVersion,
          },
        };
      });

      return {
        isError: true,
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            x402Version: 1,
            error: "_meta.x402.payment is required",
            accepts,
          }),
        }],
      };
    }

    // Payment provided - verify and execute
    try {
      // Decode payment
      const decodedPayment = JSON.parse(Buffer.from(payment as string, "base64").toString("utf-8"));
      const selectedNetwork = decodedPayment.network;

      if (!selectedNetwork) {
        throw new Error("Payment payload must include 'network' field");
      }

      // Find matching config
      const selectedConfig = paymentConfigs.find((cfg) => cfg.network === selectedNetwork);
      if (!selectedConfig) {
        throw new Error(`Network '${selectedNetwork}' is not an accepted payment option`);
      }

      // Get facilitator
      const facilitator = config.facilitators[selectedNetwork];
      if (!facilitator) {
        throw new Error(`No facilitator configured for network ${selectedNetwork}`);
      }

      // Build payment requirements
      const priceInSmallestUnit = Math.floor(parseFloat(selectedConfig.price) * 1_000_000).toString();
      const paymentRequirements: PaymentRequirements = {
        scheme: "exact",
        maxAmountRequired: priceInSmallestUnit,
        payTo: config.recipient,
        asset: selectedConfig.token,
        maxTimeoutSeconds: 300,
        resource: `${process.env.URL || "http://localhost:3000"}/mcp/tools/${toolName}`,
        mimeType: "application/json",
        description: selectedConfig.config?.description || toolDef.description,
        extra: {
          name: selectedConfig.usdcName,
          version: selectedConfig.usdcVersion,
        },
      };

      // Verify payment
      console.log("🔍 Verifying payment...");
      const verifyResult = await callFacilitator(
        "verify",
        facilitator,
        selectedConfig,
        decodedPayment,
        paymentRequirements
      );

      if (!verifyResult.isValid) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              x402Version: 1,
              error: "Invalid payment",
              details: verifyResult.invalidReason || "Payment verification failed",
            }),
          }],
        };
      }

      console.log("✅ Payment verified successfully");

      // Execute tool
      const args = toolDef.paramsSchema.parse(request.params.arguments);
      const result = await toolDef.callback(args, request.params._meta);

      // Check if execution failed
      if (result.isError) {
        console.log("❌ Tool execution failed, not settling payment");
        return result;
      }

      // Settle payment
      console.log("💰 Settling payment...");
      try {
        const settleResult = await callFacilitator(
          "settle",
          facilitator,
          selectedConfig,
          decodedPayment,
          paymentRequirements
        );

        if (!settleResult.success) {
          console.error("❌ Payment settlement failed:", settleResult.errorReason);
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                error: "Payment settlement failed",
                details: settleResult.errorReason || "Settlement unsuccessful",
              }),
            }],
          };
        }

        console.log("✅ Payment settled successfully");

        // Add settlement info to result
        if (!result._meta) {
          result._meta = {};
        }
        result._meta["x402.payment-response"] = {
          settled: true,
          txHash: settleResult.txHash,
        };
      } catch (error) {
        console.error("❌ Error settling payment:", error);
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error: "Payment settlement error",
              details: error instanceof Error ? error.message : String(error),
            }),
          }],
        };
      }

      return result;
    } catch (error) {
      console.error("❌ Error processing payment:", error);
      return {
        isError: true,
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            error: "Payment processing error",
            details: error instanceof Error ? error.message : String(error),
          }),
        }],
      };
    }
  });

  return server;
}

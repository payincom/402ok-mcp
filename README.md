# 402ok-mcp

MCP (Model Context Protocol) server middleware for HTTP 402 Payment Required protocol with **XLayer-compatible** multi-network blockchain payment support.

## Features

- 🔥 **XLayer Compatible** - Full support for OKX XLayer network with native facilitator integration
- ✅ **HTTP 402 Payment Required** - Standard implementation of the x402 protocol for MCP
- 🌐 **Multi-Network Support** - XLayer, Base, Base Sepolia, and any EVM-compatible networks
- 🔐 **OKX Facilitator** - Built-in OKX signature authentication for XLayer
- 🔌 **Standard Facilitator** - Support for x402.org and other standard facilitators
- 💳 **USDC Payments** - EIP-712 signature-based USDC transfers
- 🎯 **Paid & Free Tools** - Define both paid and free tools in the same server
- ⚡ **Complete Lifecycle** - Automatic verify → fulfill → settle flow

## Why XLayer?

XLayer is a Layer 2 blockchain built by OKX, offering:
- Low transaction fees
- Fast confirmation times
- Seamless integration with OKX ecosystem
- Native USDC support

This middleware provides **first-class XLayer support** with optimized OKX facilitator integration.

## Installation

```bash
npm install 402ok-mcp
```

## Quick Start

### Basic Usage with XLayer

```typescript
import { createPaidMcpHandler } from "402ok-mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Create MCP server with payment support
const server = createPaidMcpHandler(
  (mcp) => {
    // Define a paid tool
    mcp.paidTool(
      "premium_analysis",
      "Perform premium data analysis",
      {
        payments: [
          {
            price: "0.01",              // 0.01 USDC
            chainId: 196,               // XLayer mainnet
            token: "0x74b7f16337b8972027f6196a17a631ac6de26d22", // USDC on XLayer
            usdcName: "USD Coin",
            usdcVersion: "2",
            network: "xlayer",
            config: {
              description: "Premium analysis service"
            }
          }
        ]
      },
      z.object({
        data: z.string().describe("Data to analyze")
      }),
      async (args) => {
        // Your tool logic here
        const result = await analyzeData(args.data);
        return {
          content: [{ type: "text", text: result }]
        };
      }
    );

    // Define a free tool
    mcp.tool(
      "basic_info",
      "Get basic information (free)",
      z.object({
        query: z.string()
      }),
      async (args) => {
        return {
          content: [{ type: "text", text: `Info for: ${args.query}` }]
        };
      }
    );
  },
  { name: "my-paid-mcp-server", version: "1.0.0" },
  {
    recipient: "0xe8fb62154382af0812539cfe61b48321d8f846a8", // Your wallet
    facilitators: {
      xlayer: {
        url: "https://www.okx.com",
        type: "okx",
        okxCredentials: {
          apiKey: process.env.OKX_API_KEY!,
          secretKey: process.env.OKX_SECRET_KEY!,
          passphrase: process.env.OKX_PASSPHRASE!
        }
      }
    }
  }
);

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
```

### HTTP Server Mode (StreamableHTTPServerTransport)

Deploy as an HTTP server for web-based MCP clients:

```typescript
import express from "express";
import { randomUUID } from "node:crypto";
import { createPaidMcpHandler } from "402ok-mcp";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const app = express();
app.use(express.json());

// Store active sessions
const transports: Record<string, StreamableHTTPServerTransport> = {};

// Server configuration
const serverConfig = {
  recipient: "0xe8fb62154382af0812539cfe61b48321d8f846a8",
  facilitators: {
    xlayer: {
      url: "https://www.okx.com",
      type: "okx" as const,
      okxCredentials: {
        apiKey: process.env.OKX_API_KEY!,
        secretKey: process.env.OKX_SECRET_KEY!,
        passphrase: process.env.OKX_PASSPHRASE!
      }
    }
  }
};

// Tool setup function
const setupTools = (mcp: any) => {
  mcp.paidTool(
    "premium_analysis",
    "AI-powered premium analysis",
    {
      payments: [{
        price: "0.01",
        chainId: 196,
        token: "0x74b7f16337b8972027f6196a17a631ac6de26d22",
        usdcName: "USD Coin",
        usdcVersion: "2",
        network: "xlayer",
        config: { description: "Premium AI analysis" }
      }]
    },
    z.object({ query: z.string() }),
    async (args) => {
      return { content: [{ type: "text", text: `Analysis: ${args.query}` }] };
    }
  );
};

// Handle MCP requests
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports[sessionId]) {
    // Reuse existing session
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // New session initialization
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports[id] = transport;
        console.log("Session initialized:", id);
      },
      onsessionclosed: (id) => {
        delete transports[id];
        console.log("Session closed:", id);
      }
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        delete transports[transport.sessionId];
      }
    };

    // Create paid MCP server and connect
    const server = createPaidMcpHandler(
      setupTools,
      { name: "paid-mcp-http-server", version: "1.0.0" },
      serverConfig
    );
    await server.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Invalid session" },
      id: null
    });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

// Handle SSE for streaming responses
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  const transport = transports[sessionId];
  if (transport) {
    await transport.handleRequest(req, res);
  } else {
    res.status(400).send("Invalid session");
  }
});

// Handle session cleanup
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  const transport = transports[sessionId];
  if (transport) {
    await transport.handleRequest(req, res);
  } else {
    res.status(400).send("Invalid session");
  }
});

app.listen(3000, () => {
  console.log("Paid MCP HTTP server running on http://localhost:3000/mcp");
});
```

### Stateless HTTP Mode

For serverless/edge deployments, use stateless mode:

```typescript
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined  // Disable session management
});
```

### Pure JSON-RPC HTTP (No SDK Dependency)

MCP is just **JSON-RPC 2.0 over HTTP**. You can build a simple MCP server without `@modelcontextprotocol/sdk`:

```typescript
import express from "express";

const app = express();
app.use(express.json());

// Tool definitions
const tools = [
  {
    name: "premium_analysis",
    description: "AI-powered premium analysis",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    },
    price: "0.01",  // USDC
    handler: async (args: any) => `Analysis result for: ${args.query}`
  }
];

// JSON-RPC 2.0 handler
app.post("/mcp", async (req, res) => {
  const { jsonrpc, method, params, id } = req.body;

  if (jsonrpc !== "2.0") {
    return res.json({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request" }, id });
  }

  try {
    let result;

    switch (method) {
      case "initialize":
        // MCP handshake
        result = {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "paid-mcp-server", version: "1.0.0" }
        };
        break;

      case "tools/list":
        // List available tools
        result = {
          tools: tools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema
          }))
        };
        break;

      case "tools/call":
        // Call a tool
        const tool = tools.find(t => t.name === params.name);
        if (!tool) {
          throw { code: -32601, message: `Tool not found: ${params.name}` };
        }

        // Check payment (from _meta)
        const payment = params._meta?.["x402.payment"];

        if (!payment && tool.price) {
          // Return 402 payment required
          result = {
            isError: true,
            content: [{
              type: "text",
              text: JSON.stringify({
                x402Version: 1,
                error: "_meta.x402.payment is required",
                accepts: [{
                  scheme: "exact",
                  network: "xlayer",
                  maxAmountRequired: (parseFloat(tool.price) * 1_000_000).toString(),
                  payTo: "0xYourWalletAddress",
                  asset: "0x74b7f16337b8972027f6196a17a631ac6de26d22",
                  extra: { name: "USD Coin", version: "2" }
                }]
              })
            }]
          };
        } else {
          // Execute tool (with payment verification if needed)
          const output = await tool.handler(params.arguments);
          result = {
            content: [{ type: "text", text: output }]
          };
        }
        break;

      case "notifications/initialized":
        // Client notification - no response needed
        return res.status(204).send();

      default:
        throw { code: -32601, message: `Method not found: ${method}` };
    }

    res.json({ jsonrpc: "2.0", result, id });
  } catch (error: any) {
    res.json({
      jsonrpc: "2.0",
      error: { code: error.code || -32603, message: error.message },
      id
    });
  }
});

app.listen(3000, () => {
  console.log("Pure JSON-RPC MCP server running on http://localhost:3000/mcp");
});
```

**Key JSON-RPC Methods:**

| Method | Description |
|--------|-------------|
| `initialize` | Client handshake, returns server capabilities |
| `tools/list` | Returns available tools with schemas |
| `tools/call` | Executes a tool, params include `name`, `arguments`, `_meta` |
| `notifications/initialized` | Client confirms initialization (no response) |

**Payment Flow via `_meta`:**
- Payment is passed in `params._meta["x402.payment"]` as base64-encoded JSON
- If missing, return payment options in the response
- If present, verify → execute → settle

### Multi-Network Setup

Allow users to pay with XLayer OR Base Sepolia:

```typescript
const server = createPaidMcpHandler(
  (mcp) => {
    mcp.paidTool(
      "premium_service",
      "Premium service with multi-network payment",
      {
        payments: [
          // Option 1: XLayer (recommended for lower fees)
          {
            price: "0.1",
            chainId: 196,
            token: "0x74b7f16337b8972027f6196a17a631ac6de26d22",
            usdcName: "USD Coin",
            usdcVersion: "2",
            network: "xlayer",
            config: {
              description: "Pay with XLayer (lower fees)"
            }
          },
          // Option 2: Base Sepolia
          {
            price: "0.1",
            chainId: 84532,
            token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            usdcName: "USDC",
            usdcVersion: "2",
            network: "base-sepolia",
            config: {
              description: "Pay with Base Sepolia"
            }
          }
        ]
      },
      z.object({ input: z.string() }),
      async (args) => {
        return { content: [{ type: "text", text: "Result" }] };
      }
    );
  },
  { name: "multi-network-server", version: "1.0.0" },
  {
    recipient: "0xe8fb62154382af0812539cfe61b48321d8f846a8",
    facilitators: {
      xlayer: {
        url: "https://www.okx.com",
        type: "okx",
        okxCredentials: {
          apiKey: process.env.OKX_API_KEY!,
          secretKey: process.env.OKX_SECRET_KEY!,
          passphrase: process.env.OKX_PASSPHRASE!
        }
      },
      "base-sepolia": {
        url: "https://x402.org/facilitator",
        type: "standard"
      }
    }
  }
);
```

## How It Works

1. **Client calls MCP tool** → Server checks if tool requires payment
2. **No payment provided** → Returns error with payment options (x402 format)
3. **Client signs payment** → Creates EIP-712 signature for USDC transfer
4. **Client retries with `_meta.x402.payment`** → Includes signed payment
5. **Server verifies payment** → Calls facilitator to verify signature
6. **Server executes tool** → Runs your tool logic
7. **Server settles payment** → Calls facilitator to execute on-chain transfer
8. **Server returns result** → Includes settlement confirmation in `_meta`

All of this happens automatically!

## API Reference

### `createPaidMcpHandler(setupTools, serverInfo, config)`

Creates an MCP server with payment support.

#### Parameters

- **setupTools** `(server: PaidMcpServer) => void` - Function to register tools
- **serverInfo** `{ name: string; version: string }` - Server metadata
- **config** `ServerConfig` - Server configuration

#### Types

```typescript
interface PaymentConfig {
  price: string;           // Price in USDC (e.g., "0.1")
  chainId: number;         // Network chain ID
  token: string;           // USDC token contract address
  usdcName: string;        // USDC contract name (for EIP-712)
  usdcVersion: string;     // USDC contract version (for EIP-712)
  network: string;         // Network name (e.g., "xlayer")
  config?: {
    description?: string;
    metadata?: Record<string, any>;
  };
}

interface ServerConfig {
  recipient: string;       // Wallet address to receive payments
  facilitators: {
    [network: string]: FacilitatorConfig;
  };
}

interface FacilitatorConfig {
  url: string;
  type?: "okx" | "standard";
  okxCredentials?: {
    apiKey: string;
    secretKey: string;
    passphrase: string;
  };
}
```

### PaidMcpServer Methods

#### `paidTool(name, description, paymentOptions, paramsSchema, callback)`

Register a paid tool that requires payment before execution.

#### `tool(name, description, paramsSchema, callback)`

Register a free tool (no payment required).

## Supported Networks

### XLayer (Recommended)
- **Mainnet**: Chain ID `196`
- **Testnet**: Chain ID `195`
- **USDC Contract**: `0x74b7f16337b8972027f6196a17a631ac6de26d22` (mainnet)
- **Facilitator**: OKX facilitator with API authentication

### Other Networks
- **Base**: Standard facilitator
- **Base Sepolia**: Standard facilitator
- **Any EVM-compatible network** with USDC support

## Getting OKX Credentials

To use XLayer with OKX facilitator:

1. Create an OKX account at https://www.okx.com
2. Go to API settings
3. Create API key with x402 permissions
4. Copy API Key, Secret Key, and Passphrase to your `.env`:

```env
OKX_API_KEY=your_api_key
OKX_SECRET_KEY=your_secret_key
OKX_PASSPHRASE=your_passphrase
```

## Client Integration

MCP clients need to handle the x402 payment flow. When a tool returns an error with payment options:

```typescript
// Example handling payment in an MCP client
const result = await mcpClient.callTool("premium_analysis", { data: "..." });

if (result.isError) {
  const errorData = JSON.parse(result.content[0].text);

  if (errorData.error === "_meta.x402.payment is required") {
    // Get payment options
    const paymentOptions = errorData.accepts;

    // User signs payment with their wallet
    const signedPayment = await signPayment(paymentOptions[0]);

    // Retry with payment
    const paidResult = await mcpClient.callTool(
      "premium_analysis",
      { data: "..." },
      { _meta: { "x402.payment": signedPayment } }
    );
  }
}
```

## Security

- EIP-712 signature verification for all payments
- Facilitator double-verification (verify + settle)
- No direct blockchain access required
- Automatic payment settlement on successful tool execution only
- Failed tool execution = no payment settlement

## License

MIT

## Links

- [XLayer Official Site](https://www.okx.com/xlayer)
- [x402 Protocol](https://x402.org)
- [MCP Protocol](https://modelcontextprotocol.io)
- [GitHub Repository](https://github.com/payincom/402ok-mcp)

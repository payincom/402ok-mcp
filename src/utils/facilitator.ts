import { FacilitatorConfig, PaymentConfig, PaymentRequirements } from "../types.js";
import { makeOKXRequest, OKXCredentials } from "./okx-signature.js";

/**
 * Call facilitator to verify or settle payment
 */
export async function callFacilitator(
  action: "verify" | "settle",
  facilitator: FacilitatorConfig,
  paymentConfig: PaymentConfig,
  decodedPayment: any,
  paymentRequirements: PaymentRequirements
): Promise<{ isValid?: boolean; invalidReason?: string; success?: boolean; txHash?: string; errorReason?: string }> {

  // Build payload
  let paymentPayload = { ...decodedPayment };
  let requirements = { ...paymentRequirements };

  const payload: any = {
    x402Version: 1,
    paymentPayload,
    paymentRequirements: requirements,
  };

  if (facilitator.type === "okx") {
    // OKX: Remove network field
    delete payload.paymentPayload.network;
    delete payload.paymentRequirements.network;
    // OKX: Add chainIndex at outer level
    payload.chainIndex = paymentConfig.chainId.toString();
  } else {
    // Standard: Keep network in requirements
    payload.paymentRequirements.network = paymentConfig.network;
  }

  console.log(`🔍 Calling facilitator ${action}:`, JSON.stringify(payload, null, 2));

  let response: Response;

  if (facilitator.type === "okx" && facilitator.okxCredentials) {
    // OKX facilitator - use authenticated request
    const requestPath = `/api/v6/x402/${action}`;
    const url = `${facilitator.url}${requestPath}`;

    response = await makeOKXRequest(
      url,
      "POST",
      requestPath,
      payload,
      facilitator.okxCredentials as OKXCredentials
    );
  } else {
    // Standard facilitator - use regular fetch
    const url = `${facilitator.url}/${action}`;

    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Facilitator ${action} failed:`, errorText);
    throw new Error(`Facilitator ${action} failed: ${errorText}`);
  }

  const result: any = await response.json();
  console.log(`✅ Facilitator ${action} result:`, JSON.stringify(result, null, 2));

  // Parse response based on facilitator type
  if (facilitator.type === "okx") {
    // OKX format: { code: "0", data: [{...}] }
    if (result.code !== "0" || !result.data || result.data.length === 0) {
      throw new Error(result.msg || "OKX facilitator error");
    }
    return result.data[0];
  } else {
    // Standard format: { isValid: true } or { success: true }
    return result;
  }
}

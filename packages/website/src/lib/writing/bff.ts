export const proofingRoute = (path: string, method: string) =>
  (path === "proofing/consent" && (method === "GET" || method === "PUT")) ||
  (path === "proofing/check" && method === "POST");

export { boundedRequestBody as boundedProofingBody } from "../request-body";

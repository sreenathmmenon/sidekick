import { timingSafeEqual } from "node:crypto";

export function requireBearerToken(req, expectedToken) {
  const header = req.headers.authorization || "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) {
    return false;
  }

  const provided = header.slice(prefix.length);
  return safeEqual(provided, expectedToken);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

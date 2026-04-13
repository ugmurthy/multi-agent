import { json } from "@sveltejs/kit";
import { m as mintGatewayBrowserToken } from "../../../../chunks/local-gateway.js";
const POST = async ({ request }) => {
  const payload = await request.json().catch(() => null);
  const subject = typeof payload?.subject === "string" ? payload.subject.trim() : "";
  const tenantId = typeof payload?.tenantId === "string" ? payload.tenantId.trim() : "";
  const roleCandidates = Array.isArray(payload?.roles) ? payload.roles : [];
  const roles = Array.isArray(payload?.roles) ? roleCandidates.filter((role) => typeof role === "string" && role.trim().length > 0) : [];
  if (!subject) {
    return json({ message: "subject is required" }, { status: 400 });
  }
  const token = await mintGatewayBrowserToken({
    subject,
    tenantId: tenantId || void 0,
    roles
  });
  return json({ token });
};
export {
  POST
};

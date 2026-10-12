// api/health.js — Vercel serverless health check
export default function handler(req, res) {
  res.status(200).json({
    status: "ok",
    service: "VendorBill Auto-Hide",
    timestamp: new Date().toISOString(),
    version: "2.0.0"
  });
}

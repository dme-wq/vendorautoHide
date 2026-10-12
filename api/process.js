// api/process.js — Vercel serverless proxy to Google Apps Script
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const GAS_URL = process.env.GAS_WEB_APP_URL;
  if (!GAS_URL) {
    res.status(500).json({ error: "GAS_WEB_APP_URL environment variable not set" });
    return;
  }

  try {
    let gasRes;
    if (req.method === "POST") {
      gasRes = await fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
    } else {
      const params = new URLSearchParams(req.query).toString();
      gasRes = await fetch(`${GAS_URL}?${params}`);
    }
    const data = await gasRes.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

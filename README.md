# VendorBill Auto-Hide System 🔒

> AI-powered Google Apps Script system that automatically redacts financial amounts from vendor bills before sharing.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/dme-wq/vendorautoHide)

---

## What It Does

When you upload any bill/invoice/e-waybill to your **Source Folder**, the system automatically:

1. **Detects** new files every 5 minutes
2. **Analyzes** the document using **Gemini AI** (Gemini 1.5 Pro)
3. **Redacts** all financial details:
   - ❌ Total Amount / Grand Total
   - ❌ CGST / SGST / IGST amounts
   - ❌ Taxable Amount / Invoice Value
   - ❌ Rate / Unit Price
   - ❌ All ₹ currency values
4. **Preserves** vendor-relevant details:
   - ✅ Item names, HSN codes
   - ✅ Quantity (Qty) and Units/UOM
   - ✅ Bill number, Date, Addresses
   - ✅ GSTIN, PAN, Vehicle number
   - ✅ E-Waybill number, Transport details
5. **Saves** a vendor-safe **PDF** to the Output Folder

---

## Folder Setup

| Folder | ID | Purpose |
|--------|-----|---------|
| Source (Upload) | `1WUsajzUXRV8w_PaIrNMm71mGyg_zZPI8` | You upload bills here |
| Output (Vendor) | `1prX-2GkR0_aJZWB1FDmo3zKlVeiEEUL9` | Vendor-safe PDFs here |

---

## Supported File Types

- ✅ PDF
- ✅ Google Docs
- ✅ Google Sheets
- ✅ Images (JPG, PNG, WEBP)
- ✅ Microsoft Word (.docx)
- ✅ Microsoft Excel (.xlsx)

---

## Setup Instructions

### Step 1: Google Apps Script

1. Go to [script.google.com](https://script.google.com)
2. Create a new project → Paste `Code.gs` content
3. Enable **Drive API v2**: Extensions → Apps Script → Services → Drive API
4. Add your **Gemini API Key**:
   - Project Settings → Script Properties → Add property:
     - Name: `GEMINI_API_KEY`
     - Value: `your-key-from-aistudio.google.com`
5. Run `initialize()` function once (grant permissions)
6. Deploy as **Web App**:
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Copy the Web App URL

### Step 2: Vercel Deployment

1. Push this repo to GitHub: `https://github.com/dme-wq/vendorautoHide`
2. Connect to Vercel
3. Add environment variable: `GAS_WEB_APP_URL` = your Apps Script URL
4. In `index.html`, update `GAS_WEB_APP_URL` with your deployed URL
5. Deploy!

### Step 3: GitHub Secrets (for CI/CD)

Add these secrets in GitHub → Settings → Secrets:

| Secret | Value |
|--------|-------|
| `VERCEL_TOKEN` | From vercel.com/account/tokens |
| `VERCEL_ORG_ID` | From vercel project settings |
| `VERCEL_PROJECT_ID` | From vercel project settings |
| `GAS_SCRIPT_ID` | From Apps Script URL |
| `CLASP_CREDENTIALS` | Contents of `~/.clasprc.json` after `clasp login` |

---

## Get Gemini API Key

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Click "Create API Key"
3. Add it to Apps Script Properties as `GEMINI_API_KEY`

---

## Architecture

```
Your Drive (Source Folder)
        ↓
  [Google Apps Script — Code.gs]
  ├── Trigger: Every 5 minutes
  ├── Process: PDF / Doc / Sheet / Image
  ├── AI: Gemini 1.5 Pro (amount detection)
  ├── Redact: Table cells, paragraphs, regex
  └── Export: PDF → Output Folder
        ↓
  Vendor-Safe Output Folder
  (Shared with vendor — no amounts visible)

Dashboard (Vercel)
  ├── index.html (frontend)
  ├── api/health.js
  └── api/process.js → GAS Web App
```

---

## Dashboard

The Vercel dashboard lets you:
- View processing statistics
- Manually trigger processing
- Process a single file by ID
- View full processing log with links to output PDFs

---

Made with ❤️ using Google Apps Script + Gemini AI

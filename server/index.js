import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import {
  S3Client,
  DeleteObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

dotenv.config();

// ── S3 / R2 client ───────────────────────────────────────────────────────────
const s3 = new S3Client({
  region: process.env.AWS_REGION ?? "auto",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  // Cloudflare R2 only — remove this block if using AWS S3
  ...(process.env.CF_ACCOUNT_ID && {
    endpoint: `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  }),
});

const BUCKET = process.env.S3_BUCKET;
const API_KEY = process.env.API_KEY; // optional bearer-token guard

// ── App ──────────────────────────────────────────────────────────────────────
const app = express();
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://storage-browser-drab.vercel.app",
    ],
  }),
);
app.use(express.json());

// Optional API-key auth (skipped if API_KEY not set in .env)
app.use((req, res, next) => {
  if (!API_KEY) return next();
  const auth = req.headers.authorization ?? "";
  if (auth !== `Bearer ${API_KEY}`)
    return res.status(401).json({ error: "Unauthorized" });
  next();
});

// ── Routes ───────────────────────────────────────────────────────────────────

// Health check — the frontend hits this when you click "Test connection"
app.get("/health", (_req, res) => res.json({ ok: true }));

// Step 1 of upload: return a presigned PUT URL for the client to push bytes directly to S3
app.post("/uploads/init", async (req, res) => {
  try {
    const { bucket, path, filename, size, contentType } = req.body;
    console.log(
      `⬆ Upload request: ${filename} (${(size / 1024 / 1024).toFixed(2)} MB) → ${bucket}/${path}`,
    );

    // Build the S3 key:  bucketName/folder/subfolder/file.ext
    const key = [bucket, path, filename].filter(Boolean).join("/");

    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType ?? "application/octet-stream",
      ContentLength: size,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    res.json({ uploadUrl, objectId: key });
  } catch (err) {
    console.error("uploads/init error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Step 3 of upload: client tells us the PUT succeeded (no-op — S3 confirmed directly)
app.post("/uploads/complete", (_req, res) => res.json({ ok: true }));

// Delete one object by its logical path inside the bucket
app.delete("/objects", async (req, res) => {
  try {
    const { bucket, path } = req.body;
    const key = [bucket, path].filter(Boolean).join("/");

    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));

    res.json({ ok: true });
  } catch (err) {
    console.error("delete error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () =>
  console.log(`DataVault API  →  http://localhost:${PORT}`),
);

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");
const Razorpay = require("razorpay");
const { nanoid } = require("nanoid");
const db = require("./db");

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const PRICE_PAISE = Number(process.env.PRODUCT_PRICE_PAISE || 59900);
const CURRENCY = process.env.PRODUCT_CURRENCY || "INR";
const EXPIRY_HOURS = Number(process.env.DOWNLOAD_LINK_EXPIRY_HOURS || 72);
const MAX_USES = Number(process.env.DOWNLOAD_MAX_USES || 5);
const FILE_PATH = path.join(__dirname, "private-files", process.env.PRODUCT_FILE_NAME || "");

/* ------------------------------------------------------------
   1) Create a Razorpay order.
   Frontend calls this first, before opening the Razorpay popup.
   Amount is decided by the SERVER, never trust a price sent
   from the browser — otherwise anyone could pay ₹1 for the book.
------------------------------------------------------------ */
app.post("/api/orders", async (req, res) => {
  try {
    const { email } = req.body;
    const order = await razorpay.orders.create({
      amount: PRICE_PAISE,
      currency: CURRENCY,
      receipt: `receipt_${Date.now()}`,
      notes: { email: email || "" },
    });
    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID, // public key, safe to expose
    });
  } catch (err) {
    console.error("Order creation failed:", err);
    res.status(500).json({ error: "Could not create order" });
  }
});

/* ------------------------------------------------------------
   2) Verify the payment after Razorpay's checkout popup succeeds.
   This signature check is the ONLY way to trust that a payment
   actually happened — never mark an order "paid" just because
   the frontend says so.
------------------------------------------------------------ */
app.post("/api/verify", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, email } = req.body;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: "Payment verification failed" });
    }

    // Payment is genuine. Issue a secure, time-limited download token.
    const token = nanoid(32);
    const record = {
      token,
      email: email || "",
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      createdAt: Date.now(),
      expiresAt: Date.now() + EXPIRY_HOURS * 60 * 60 * 1000,
      usesCount: 0,
      maxUses: MAX_USES,
    };
    db.saveDownloadToken(record);
    db.saveOrder({ razorpayOrderId: razorpay_order_id, email, paidAt: Date.now() });

    const downloadUrl = `${req.protocol}://${req.get("host")}/api/download/${token}`;

    if (email) {
      sendDownloadEmail(email, downloadUrl).catch((e) =>
        console.error("Email send failed (order still succeeded):", e)
      );
    }

    res.json({ success: true, downloadUrl });
  } catch (err) {
    console.error("Verification error:", err);
    res.status(500).json({ error: "Something went wrong verifying payment" });
  }
});

/* ------------------------------------------------------------
   3) Secure download endpoint.
   The actual file lives OUTSIDE any publicly served folder.
   This is the only route that can serve it, and only with a
   valid, unexpired, not-overused token.
------------------------------------------------------------ */
app.get("/api/download/:token", (req, res) => {
  const record = db.getDownloadToken(req.params.token);

  if (!record) return res.status(404).send("Invalid or unknown download link.");
  if (Date.now() > record.expiresAt) return res.status(410).send("This download link has expired.");
  if (record.usesCount >= record.maxUses) return res.status(429).send("This download link has been used too many times.");
  if (!fs.existsSync(FILE_PATH)) return res.status(500).send("File not found on server. Contact support.");

  db.incrementTokenUse(req.params.token);
  res.download(FILE_PATH, process.env.PRODUCT_FILE_NAME);
});

/* ------------------------------------------------------------
   Email delivery
------------------------------------------------------------ */
async function sendDownloadEmail(toEmail, downloadUrl) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: `Your download: ${process.env.PRODUCT_NAME}`,
    html: `
      <p>Thank you for your purchase!</p>
      <p><a href="${downloadUrl}">Click here to download your ebook</a></p>
      <p>This link works for ${EXPIRY_HOURS} hours and can be used up to ${MAX_USES} times,
      so it's safe to use it on more than one device.</p>
    `,
  });
}

/* ------------------------------------------------------------
   Health check (useful when deploying, to confirm it's alive)
------------------------------------------------------------ */
app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Ebook store server running on port ${PORT}`));

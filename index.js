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
const products = require("./products");

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const EXPIRY_HOURS = Number(process.env.DOWNLOAD_LINK_EXPIRY_HOURS || 72);
const MAX_USES = Number(process.env.DOWNLOAD_MAX_USES || 5);

/* ------------------------------------------------------------
   1) Create a Razorpay order for a specific product.
   The price always comes from products.js on the SERVER —
   never from the browser, so nobody can pay less than intended.
------------------------------------------------------------ */
app.post("/api/orders", async (req, res) => {
  try {
    const { email, productId } = req.body;
    const product = products.find((p) => p.id === productId);
    if (!product) return res.status(400).json({ error: "Unknown product" });

    const order = await razorpay.orders.create({
      amount: product.pricePaise,
      currency: product.currency,
      receipt: `receipt_${Date.now()}`,
      notes: { email: email || "", productId },
    });

    // Remember which product this order was for, BEFORE payment happens.
    // This is what verification will trust later — not anything the
    // browser claims after the fact.
    db.saveOrder({
      razorpayOrderId: order.id,
      email,
      productId,
      paidAt: null,
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

    // Look up which product this order was for — recorded at order
    // creation time, never trusted from the browser at this step.
    const orderRecord = db.getOrderByRazorpayId(razorpay_order_id);
    if (!orderRecord) return res.status(400).json({ error: "Unknown order" });

    const product = products.find((p) => p.id === orderRecord.productId);
    if (!product) return res.status(400).json({ error: "Product no longer available" });

    const token = nanoid(32);
    db.saveDownloadToken({
      token,
      email: email || orderRecord.email || "",
      productId: product.id,
      fileName: product.fileName,
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      createdAt: Date.now(),
      expiresAt: Date.now() + EXPIRY_HOURS * 60 * 60 * 1000,
      usesCount: 0,
      maxUses: MAX_USES,
    });

    db.saveOrder({ ...orderRecord, paidAt: Date.now() });

    const downloadUrl = `${req.protocol}://${req.get("host")}/api/download/${token}`;

    if (email) {
      sendDownloadEmail(email, downloadUrl, product.name).catch((e) =>
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
   3) Secure download endpoint — works for any product, based on
   what was recorded in the token itself.
------------------------------------------------------------ */
app.get("/api/download/:token", (req, res) => {
  const record = db.getDownloadToken(req.params.token);

  if (!record) return res.status(404).send("Invalid or unknown download link.");
  if (Date.now() > record.expiresAt) return res.status(410).send("This download link has expired.");
  if (record.usesCount >= record.maxUses) return res.status(429).send("This download link has been used too many times.");

  const filePath = path.join(__dirname, "private-files", record.fileName);
  if (!fs.existsSync(filePath)) return res.status(500).send("File not found on server. Contact support.");

  db.incrementTokenUse(req.params.token);
  res.download(filePath, record.fileName);
});

/* ------------------------------------------------------------
   4) Public product list — lets any future frontend ask
   "what books are for sale and at what price?" without
   hardcoding prices into the website itself.
------------------------------------------------------------ */
app.get("/api/products", (req, res) => {
  res.json(
    products.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.pricePaise / 100,
      currency: p.currency,
    }))
  );
});

/* ------------------------------------------------------------
   Email delivery
------------------------------------------------------------ */
async function sendDownloadEmail(toEmail, downloadUrl, productName) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: `Your download: ${productName}`,
    html: `
      <p>Thank you for your purchase!</p>
      <p><a href="${downloadUrl}">Click here to download your ebook</a></p>
      <p>This link works for ${EXPIRY_HOURS} hours and can be used up to ${MAX_USES} times,
      so it's safe to use it on more than one device.</p>
    `,
  });
}

app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Ebook store server running on port ${PORT}`));

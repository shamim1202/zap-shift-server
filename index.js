const express = require("express");
const cors = require("cors");
const port = process.env.PORT || 3000;
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const app = express();
const crypto = require("crypto");

function generateTrackingID() {
  const prefix = "PRCL";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();

  return `${prefix}-${date}-${random}`;
}

// Middleware ----------------------------------------->
app.use(express.json());
app.use(cors());

// MongoDB connection --------------------------------->
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qx9mzcm.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    await client.connect();

    const db = client.db("zap-shift");
    const parcelCollection = db.collection("parcels");
    const paymentCollection = db.collection("payments");

    // Get parcel by email api cal ----------------------|
    app.get("/parcels", async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) {
        query.senderEmail = email;
      }
      const options = { sort: { createdAt: -1 } };
      const cursor = parcelCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    // Paid a parcel with id  by get id api call --------|
    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.findOne(query);
      res.send(result);
    });

    // Add parcel by post api call ---------------------|
    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      parcel.createdAt = new Date();
      const result = await parcelCollection.insertOne(parcel);
      res.send(result);
    });

    // Delete a parcel by delete api call -----------------|
    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.deleteOne(query);
      res.send(result);
    });

    // Payment Gateway International (Stripe) Api -----------|
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.parcelName,
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          parcelId: paymentInfo.parcelId,
        },
        customer_email: paymentInfo.senderEmail,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      console.log(session);
      res.send({ url: session.url });
    });

    // Payment Gateway International (Stripe) Api (Alt) -----------|
    app.post("/payment-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: `Please pay for ${paymentInfo.parcelName}`,
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,
        },
        customer_email: paymentInfo.senderEmail,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const trackingId = generateTrackingID();

      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };

      const paymentExist = await paymentCollection.findOne(query);
      console.log(paymentExist);
      if (paymentExist) {
        return res.send({
          message: "Transaction Id Already Exits:",
          transactionId,
          trackingId: trackingId,
        });
      }

      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
            trackingId: trackingId,
          },
        };
        const result = await parcelCollection.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId,
        };

        if (session.payment_status === "paid") {
          const resultPayment = await paymentCollection.insertOne(payment);
          res.send({
            success: true,
            modifyParcel: result,
            paymentInfo: resultPayment,
            trackingId: trackingId,
            transactionId: session.payment_intent,
          });
        }

        res.send(result);
      }

      res.send({ success: false });
    });

    app.get("/payments", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.customerEmail = email;
      }
      const cursor = paymentCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

// Basic Testing Api Connection ----------------------->
app.get("/", (req, res) => {
  res.send("Zap is Shifting Shifting");
});

app.listen(port, () => {
  console.log("Zap is Shifting Shifting on the port:", port);
});

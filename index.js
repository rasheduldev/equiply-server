import dns from 'node:dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import express from "express";
import cors from "cors";
import "dotenv/config";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

import { MongoClient, ObjectId } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
  try {
    // await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB();
const database = connectedClient.db("equiplydb");
const users = database.collection("user");
const sessions = database.collection("session");
const equipments = database.collection("equipments");
const bookings = database.collection("bookings");
const payments = database.collection("payments");
const favorites = database.collection('favorites')



const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).send({
                message: "Unauthorized access"
            });
        }

        const token = authHeader.split(" ")[1];

        if (!token) {
            return res.status(401).send({
                message: "Unauthorized access"
            });
        }

        // Find the session in Better Auth's session collection
        const session = await sessions.findOne({
            token,
            expiresAt: { $gt: new Date() }
        });

        if (!session) {
            return res.status(401).send({
                message: "Invalid or expired session"
            });
        }

        // Find the user associated with this session
        const user = await users.findOne({
            _id: session.userId
        });

        if (!user) {
            return res.status(401).send({
                message: "User not found"
            });
        }

        req.user = user;

        next();

    } catch (error) {
        console.error("Token verification error:", error);

        return res.status(500).send({
            message: "Internal server error"
        });
    }
};


const verifyAdmin = async (req, res, next) => {
    if (req.user.role !== "admin") {
        return res.status(403).send({
            message: "Forbidden: Admin access required"
        });
    }
    next();
};

// admin related API's
app.get("/admin/users", verifyToken, verifyAdmin, async (req, res) => {
    const result = await users.find({}).toArray();
    res.send(result);
});

app.patch("/admin/users/:id/role", verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    if (!["customer", "owner", "admin"].includes(role)) {
        return res.status(400).send({ message: "Invalid role" });
    }

    if (req.user._id.toString() === id) {
        return res.status(403).send({ message: "You cannot change your own role" });
    }

    const user = await users.findOne({ _id: new ObjectId(id) });

    if (!user) {
        return res.status(404).send({ message: "User not found" });
    }

    if (user.role === "admin" && role !== "admin") {
        const adminCount = await users.countDocuments({ role: "admin" });

        if (adminCount === 1) {
            return res.status(400).send({ message: "At least one admin must remain" });
        }
    }

    const result = await users.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
    );

    res.send(result);
});

app.get("/admin/equipments", verifyToken, verifyAdmin, async (req, res) => {
    const result = await equipments.find({}).toArray();
    res.send(result);
});

app.patch("/admin/equipments/:id/status", verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const result = await equipments.updateOne(
        { _id: new ObjectId(id) },
        {
            $set: {
                status: status
            }
        }
    );
    res.send(result);
});

app.patch("/admin/equipments/:id", verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const updatedEquipment = req.body;

    const result = await equipments.updateOne(
        { _id: new ObjectId(id) },
        {
            $set: updatedEquipment
        }
    );

    res.send(result);
});

app.delete("/admin/equipments/:id", verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;

    const result = await equipments.deleteOne(
        { _id: new ObjectId(id) }
    );

    res.send(result);
});

app.get("/admin/rentals", verifyToken, verifyAdmin, async (req, res) => {
    const result = await bookings.find({})
        .sort({ createdAt: -1 })
        .toArray();

    res.send(result);
});
app.get("/admin/analytics", verifyToken, verifyAdmin, async (req, res) => {
    const [allUsers, allEquipments, allBookings, allPayments] =
        await Promise.all([
            users.find({}).toArray(),
            equipments.find({}).toArray(),
            bookings.find({}).toArray(),
            payments.find({ paymentStatus: "Paid" }).toArray()
        ]);

    res.send({
        users: allUsers,
        equipments: allEquipments,
        bookings: allBookings,
        payments: allPayments
    });
});
// users related API's
app.get("/users", async (req, res) => {
  const cursor = users.find({});
  const result = await cursor.toArray();
  res.send(result);
});

app.get('/users/:id', async (req, res) => {
    const { id } = req.params;

    const result = await users.findOne({
        _id: new ObjectId(id)
    });

    res.send(result);
});

app.patch('/users/:id', async (req, res) => {
    const { id } = req.params;
    const updatedProfile = req.body;

    const result = await users.updateOne(
        { _id: new ObjectId(id) },
        {
            $set: {
                name: updatedProfile.name,
                image: updatedProfile.image,
                phone: updatedProfile.phone,
                address: updatedProfile.address,
                updatedAt: new Date()
            }
        }
    );

    res.send(result);
});

app.get("/owner/analytics", verifyToken, async (req, res) => {
    if (req.user.role !== "owner") {
        return res.status(403).send({
            message: "Owner access required"
        });
    }
    const ownerId = req.user._id.toString();

    const ownerEquipments = await equipments.find({
        ownerId: ownerId
    }).toArray();

    const equipmentIds = ownerEquipments.map(item => item._id.toString());

    const ownerBookings = await bookings.find({
        equipmentId: { $in: equipmentIds }
    }).toArray();

    res.send({
        equipments: ownerEquipments,
        bookings: ownerBookings
    });
});

// equipments related API's
app.post("/equipments", async (req, res) => {
  const equipment = req.body;
  const result = await equipments.insertOne(equipment);
  res.send(result);
});


app.get("/equipments", async (req, res) => {
    const query = {};

    if (req.query) {
        // Only show approved equipment
        query.status = "Approved";

        // Search by equipment name, location, and category
        if (req.query.search) {
            query.$or = [
                { name: { $regex: req.query.search, $options: "i" } },
                { location: { $regex: req.query.search, $options: "i" } },
                { category: { $regex: req.query.search, $options: "i" } },
            ];
        }

        // Filter by category
        if (req.query.category) {
            query.category = req.query.category;
        }

        // Filter by rental type
        if (req.query.rentalType) {
            query.rentalType = req.query.rentalType;
        }

        // Filter by price range
        if (req.query.minPrice || req.query.maxPrice) {
            query.rentalPrice = {};

            if (req.query.minPrice) {
                query.rentalPrice.$gte = Number(req.query.minPrice);
            }

            if (req.query.maxPrice) {
                query.rentalPrice.$lte = Number(req.query.maxPrice);
            }
        }

        // Filter by availability
        if (req.query.availability === "available") {
            query.availableQuantity = { $gt: 0 };
        }

        if (req.query.availability === "unavailable") {
            query.availableQuantity = 0;
        }
    }

    // Sorting
    let cursor = equipments.find(query);

    if (req.query.sort === "price-low") {
        cursor = cursor.sort({ rentalPrice: 1 });
    }

    if (req.query.sort === "price-high") {
        cursor = cursor.sort({ rentalPrice: -1 });
    }

    if (req.query.sort === "recent") {
        cursor = cursor.sort({ _id: -1 });
    }

    // Limit results
    if (req.query.limit) {
        const limit = Number(req.query.limit);

        if (Number.isInteger(limit) && limit > 0) {
            cursor = cursor.limit(limit);
        }
    }

    const result = await cursor.toArray();
    res.send(result);
});

app.get("/equipments/:id", async (req, res) => {
  const { id } = req.params;
  const query = { _id: new ObjectId(id) };
  const result = await equipments.findOne(query);
  res.send(result);
});

app.delete("/equipments/:id", async (req, res) => {
  const { id } = req.params;
  const query = { _id: new ObjectId(id) };
  const result = await equipments.deleteOne(query);
  res.send(result);
});

// bookings related API's
app.post("/bookings", async (req, res) => {
  const booking = req.body;
  const result = await bookings.insertOne(booking);
  res.send(result);
});


app.get("/bookings", async (req, res) => {
  const result = await bookings.find().sort({ createdAt: -1 }).toArray();
  res.send(result);
});

app.post("/bookings/pending", async (req, res) => {
    try {
        const booking = req.body;

        const equipment = await equipments.findOne({
            _id: new ObjectId(booking.equipmentId)
        });

        if (!equipment) {
            return res.status(404).send({
                success: false,
                message: "Equipment not found"
            });
        }

        const pendingBooking = {
            ...booking,
            ownerName: equipment.ownerName,
            ownerEmail: equipment.ownerEmail,
            paymentStatus: "Pending",
            bookingStatus: "Pending",
            createdAt: new Date(),
        };

        const result = await bookings.insertOne(pendingBooking);

        res.send({
            success: true,
            message: "Pending booking created successfully",
            bookingId: result.insertedId.toString(),
        });

    } catch (error) {
        console.error("Pending booking error:", error);

        res.status(500).send({
            success: false,
            message: "Failed to create pending booking",
        });
    }
});

app.get("/bookings/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const query = { userId };

    const result = await bookings.find(query).sort({ createdAt: -1 }).toArray();

    res.send(result);
  } catch (error) {
    console.error("Error fetching bookings:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch bookings",
    });
  }
});

// Verify Stripe payment and update booking

app.post("/payments/checkout-verify", async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).send({
        success: false,
        message: "Session ID is required",
      });
    }

    // 1. Retrieve Stripe Checkout Session
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.status !== "complete" || session.payment_status !== "paid") {
      return res.status(400).send({
        success: false,
        message: "Payment verification failed",
      });
    }

    // 2. Get bookingId and userId from Stripe metadata
    const bookingId = session.metadata?.bookingId;
    const userId = session.metadata?.userId;

    if (!bookingId || !userId) {
      return res.status(400).send({
        success: false,
        message: "Booking ID or User ID not found in Stripe metadata",
      });
    }
    // Check whether this Stripe session was already verified
    const existingPayment = await payments.findOne({ sessionId });

    if (existingPayment) {
      return res.send({
        success: true,
        message: "Payment already verified",
        payment: existingPayment,
      });
    }
    // 3. Find the exact pending booking
    const booking = await bookings.findOne({
      _id: new ObjectId(bookingId),
      userId,
      paymentStatus: "Pending",
    });

    if (!booking) {
      return res.status(404).send({
        success: false,
        message: "Pending booking not found",
      });
    }

    // 4. Update booking status
    const bookingResult = await bookings.updateOne(
      {
        _id: booking._id,
        paymentStatus: "Pending",
      },
      {
        $set: {
          paymentStatus: "Paid",
          bookingStatus: "Confirmed",
          paidAt: new Date(),
        },
      },
    );

    if (bookingResult.modifiedCount === 0) {
      return res.status(409).send({
        success: false,
        message: "Booking has already been processed",
      });
    }

    // 5. Save payment information
    const payment = {
      sessionId,
      bookingId: booking._id,
      userId,
      customerEmail: session.customer_details?.email || session.customer_email,
      paymentIntentId: session.payment_intent,
      amount: session.amount_total / 100,
      currency: session.currency,
      paymentStatus: "Paid",
      paymentDate: new Date(),
    };

    const paymentResult = await payments.insertOne(payment);

    res.send({
      success: true,
      message: "Payment verified successfully",
      bookingResult,
      paymentResult,
    });
  } catch (error) {
    console.error("Payment verification error:", error);

    res.status(500).send({
      success: false,
      message: "Something went wrong during payment verification",
    });
  }
});

// favorite related API's

app.post('/favorites', async (req, res) => {
    try {
        const { userId, equipmentId } = req.body;
        if (!userId || !equipmentId) {
            return res.status(400).send({
                success: false,
                message: 'User ID and Equipment ID are required'
            });
        }
        const existingFavorite = await favorites.findOne({
            userId,
            equipmentId
        });
        if (existingFavorite) {
            return res.status(409).send({
                success: false,
                message: 'Equipment is already in favorites'
            });
        }
        const favorite = {
            userId,
            equipmentId,
            createdAt: new Date()
        };
        const result = await favorites.insertOne(favorite);
        res.send({
            success: true,
            message: 'Added to favorites successfully',
            insertedId: result.insertedId
        });
    } catch (error) {
        console.error('Add favorite error:', error);

        res.status(500).send({
            success: false,
            message: 'Failed to add favorite'
        });
    }
});


app.get('/favorites/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const result = await favorites.aggregate([
            {
                $match: { userId }
            },
            {
                $addFields: {
                    equipmentObjectId: {
                        $convert: {
                            input: '$equipmentId',
                            to: 'objectId',
                            onError: null,
                            onNull: null
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: 'equipments',
                    localField: 'equipmentObjectId',
                    foreignField: '_id',
                    as: 'equipment'
                }
            },
            {
                $unwind: {
                    path: '$equipment',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $project: {
                    equipmentObjectId: 0
                }
            },
            {
                $sort: { createdAt: -1 }
            }
        ]).toArray();

        res.send(result);

    } catch (error) {
        console.error('Get favorites error:', error);

        res.status(500).send({
            success: false,
            message: 'Failed to fetch favorites'
        });
    }
});


app.delete('/favorites/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                success: false,
                message: 'Invalid favorite ID'
            });
        }

        const result = await favorites.deleteOne({
            _id: new ObjectId(id)
        });

        if (result.deletedCount === 0) {
            return res.status(404).send({
                success: false,
                message: 'Favorite not found'
            });
        }

        res.send({
            success: true,
            message: 'Favorite removed successfully'
        });

    } catch (error) {
        console.error('Remove favorite error:', error);

        res.status(500).send({
            success: false,
            message: 'Failed to remove favorite'
        });
    }
});



app.get("/", (req, res) => {
  res.send("Equiply is running fine!");
});

app.listen(port, () => {
  console.log(`Equiply is running on port ${port}`);
});

export default app;
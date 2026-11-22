import express from 'express';
import cors from 'cors'
import 'dotenv/config'
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 8000;

app.use(cors())
app.use(express.json())

import { MongoClient, ObjectId } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB()
const database = connectedClient.db('equiplydb')
const users = database.collection('user')
const equipments = database.collection('equipments')
const bookings = database.collection('bookings')
const payments = database.collection('payments')
app.get('/users', async(req, res)=>{
    const cursor = users.find({})
    const result = await cursor.toArray()
    res.send(result)
})

// equipments related API's
app.post('/equipments', async (req, res) => {
    const equipment = req.body;
    const result = await equipments.insertOne(equipment);
    res.send(result);
})

app.get('/equipments', async (req, res) => {
    const query = {};
    if (req.query) {
        // Only show approved equipment
        query.status = 'Approved';
        // Search by equipment name, location, and category
        if (req.query.search) {
            query.$or = [
                { name: { $regex: req.query.search, $options: 'i' } },
                { location: { $regex: req.query.search, $options: 'i' } },
                { category: { $regex: req.query.search, $options: 'i' } }
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
        if (req.query.availability === 'available') {
            query.availableQuantity = { $gt: 0 };
        }
        if (req.query.availability === 'unavailable') {
            query.availableQuantity = 0;
        }
    }
    // Sorting
    let cursor = equipments.find(query);
    if (req.query.sort === 'price-low') {
        cursor = cursor.sort({ rentalPrice: 1 });
    }
    if (req.query.sort === 'price-high') {
        cursor = cursor.sort({ rentalPrice: -1 });
    }
    if (req.query.sort === 'recent') {
        cursor = cursor.sort({ _id: -1 });
    }
    const result = await cursor.toArray();
    res.send(result);
})

app.get('/equipments/:id', async (req, res) => {
    const {id} = req.params;
    const query = { _id: new ObjectId(id) };
    const result = await equipments.findOne(query);
    res.send(result);
})

app.delete('/equipments/:id', async (req, res) => {
    const {id} = req.params;
    const query = { _id: new ObjectId(id) };
    const result = await equipments.deleteOne(query);
    res.send(result);
})

// bookings related API's
app.post('/bookings', async (req, res) => {
    const booking = req.body;
    const result = await bookings.insertOne(booking);
    res.send(result);
});

app.post('/bookings/pending', async (req, res) => {
    const booking = req.body;
    const pendingBooking = {
        ...booking,
        paymentStatus: 'Pending',
        bookingStatus: 'Pending',
        createdAt: new Date(),
    };
    const result = await bookings.insertOne(pendingBooking);
    res.send(result);
});

// Verify Stripe payment and update booking
app.post('/payments/checkout-verify', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).send({
                success: false,
                message: 'Session ID is required'
            });
        }

        // 1. Retrieve checkout session from Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        // 2. Check payment status
        if (session.status !== 'complete' || session.payment_status !== 'paid') {
            return res.status(400).send({
                success: false,
                message: 'Payment verification failed'
            });
        }

        // 3. Get customer ID from Stripe metadata
        const userId = session.metadata?.userId;

        if (!userId) {
            return res.status(400).send({
                success: false,
                message: 'Customer ID not found'
            });
        }

        // 4. Check whether this payment was already saved
        const existingPayment = await payments.findOne({ sessionId });

        if (existingPayment) {
            return res.send({
                success: true,
                message: 'Payment already verified',
                payment: existingPayment
            });
        }

        // 5. Find the customer's pending booking
        const pendingBookings = await bookings
            .find({
                userId,
                paymentStatus: 'Pending'
            })
            .limit(2)
            .toArray();

        // We need exactly one pending booking
        if (pendingBookings.length !== 1) {
            return res.status(400).send({
                success: false,
                message: pendingBookings.length === 0
                    ? 'No pending booking found'
                    : 'Multiple pending bookings found. Cannot identify the correct booking.'
            });
        }

        const booking = pendingBookings[0];

        // 6. Update booking status
        const bookingResult = await bookings.updateOne(
            {
                _id: booking._id,
                paymentStatus: 'Pending'
            },
            {
                $set: {
                    paymentStatus: 'Paid',
                    bookingStatus: 'Confirmed',
                    paidAt: new Date()
                }
            }
        );

        if (bookingResult.modifiedCount === 0) {
            return res.status(409).send({
                success: false,
                message: 'Booking has already been processed'
            });
        }

        // 7. Save payment transaction
        const payment = {
            sessionId,
            bookingId: booking._id,
            userId,
            customerEmail: session.customer_details?.email || session.customer_email,
            paymentIntentId: session.payment_intent,
            amount: session.amount_total / 100,
            currency: session.currency,
            paymentStatus: 'Paid',
            paymentDate: new Date()
        };

        const paymentResult = await payments.insertOne(payment);

        res.send({
            success: true,
            message: 'Payment verified successfully',
            bookingResult,
            paymentResult
        });

    } catch (error) {
        console.error('Payment verification error:', error);

        res.status(500).send({
            success: false,
            message: 'Something went wrong during payment verification'
        });
    }
});



app.get('/', (req, res) => {
  res.send('Equiply is running fine!');
});

app.listen(port, () => {
  console.log(`Equiply is running on port ${port}`);
});
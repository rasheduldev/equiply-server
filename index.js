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




app.get('/', (req, res) => {
  res.send('Equiply is running fine!');
});

app.listen(port, () => {
  console.log(`Equiply is running on port ${port}`);
});
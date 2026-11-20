import express from 'express';
import cors from 'cors'
import 'dotenv/config'

const app = express();
const port = process.env.PORT || 8000;

app.use(cors())
app.use(express.json())

import { MongoClient } from 'mongodb';

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

app.get('/users', async(req, res)=>{
    const cursor = users.find({})
    const result = await cursor.toArray()
    res.send(result)
})


app.get('/', (req, res) => {
  res.send('Equiply is running fine!');
});

app.listen(port, () => {
  console.log(`Equiply is running on port ${port}`);
});
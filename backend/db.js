
// backend/db.js (ESM)
// Simple MongoDB connection utility
import { MongoClient } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'tutedude_proctor';

let client;
let db;

export async function connectDB() {
  if (db) return db;
  client = new MongoClient(MONGO_URL, { useUnifiedTopology: true });
  await client.connect();
  db = client.db(DB_NAME);
  return db;
}

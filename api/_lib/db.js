'use strict';

const { MongoClient } = require('mongodb');

let clientPromise;

function getClientPromise() {
  if (!process.env.MONGODB_URI || !process.env.MONGODB_DB_NAME) {
    const error = new Error('Database is not configured. Set MONGODB_URI and MONGODB_DB_NAME in the server environment.');
    error.code = 'DATABASE_NOT_CONFIGURED';
    throw error;
  }
  if (!clientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      appName: 'spring-atlas',
      maxPoolSize: 5,
      minPoolSize: 0,
      maxIdleTimeMS: 30_000,
      waitQueueTimeoutMS: 5_000,
      connectTimeoutMS: 8_000,
      serverSelectionTimeoutMS: 8_000,
    });
    clientPromise = client.connect().catch(error => {
      clientPromise = undefined;
      // Never include or log the connection URI.
      throw error;
    });
  }
  return clientPromise;
}

async function getDb() {
  const client = await getClientPromise();
  return client.db(process.env.MONGODB_DB_NAME);
}

async function getClient() {
  return getClientPromise();
}

async function pingDatabase() {
  const db = await getDb();
  await db.command({ ping: 1 });
  return true;
}

module.exports = { getDb, getClient, pingDatabase };

'use strict';
const mongoose = require('mongoose');

/** Connects to MongoDB. Throws on failure so the caller decides whether to exit. */
async function connectDB(uri, logger) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  logger?.info('MongoDB connected');
  return mongoose.connection;
}

module.exports = connectDB;

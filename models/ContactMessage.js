'use strict';
const mongoose = require('mongoose');

const ContactMessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    read: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ContactMessageSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ContactMessage', ContactMessageSchema);

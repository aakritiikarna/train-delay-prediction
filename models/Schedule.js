const mongoose = require('mongoose');

const ScheduleSchema = new mongoose.Schema({
  trainId:            String,
  line:               String,
  scheduledTime:      String,   // ← controller dashboard
  actualTime:         String,   // ← controller dashboard
  scheduledDeparture: String,   // ← passenger dashboard
  scheduledArrival:   String,   // ← passenger dashboard
  delay:              { type: Number, default: 0 },
  destination:        String,   // ← controller dashboard
  driver:             String,   // ← controller dashboard
  status:             String
}, { timestamps: true });

module.exports = mongoose.model('Schedule', ScheduleSchema);
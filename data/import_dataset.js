require('dotenv').config();
const mongoose = require('mongoose');
const csv = require('csvtojson');
const Disruption = require('../models/Disruption');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const rows = await csv().fromFile('./data/train_delays.csv');

  const docs = rows.map((row, i) => ({
    trainId:  (row['Train Type'] || 'TR').slice(0, 2).toUpperCase() + '-' + String(i).padStart(3, '0'),
    line:     row['Route Congestion'] ? `Congestion: ${row['Route Congestion']}` : 'Unknown',
    cause:    row['Weather Conditions'] || 'Unknown',
    delay:    parseInt(row['Historical Delay (min)']) || 0,
    severity: parseInt(row['Historical Delay (min)']) > 20 ? 'Critical'
            : parseInt(row['Historical Delay (min)']) > 10 ? 'Moderate' : 'Minor',
    status:   'Resolved'
  }));

  await Disruption.insertMany(docs);
  console.log(`Imported ${docs.length} records`);
  mongoose.disconnect();
});
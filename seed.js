require('dotenv').config();
const mongoose = require('mongoose');
const Disruption = require('./models/Disruption');
const Schedule = require('./models/Schedule');
const User = require('./models/User');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  await Disruption.deleteMany({});
  await Schedule.deleteMany({});
  await User.deleteMany({});

  await Disruption.insertMany([
    { trainId: 'TR-303', line: 'Line A', cause: 'Signal Failure',    delay: 25, severity: 'Critical' },
    { trainId: 'TR-202', line: 'Line B', cause: 'Track Maintenance', delay: 10, severity: 'Moderate' },
    { trainId: 'TR-505', line: 'Line C', cause: 'Passenger Incident',delay: 12, severity: 'Moderate' }
  ]);

 await Schedule.insertMany([
  {
    trainId: 'TR-101',
    line: 'Line A',
    scheduledTime:      '08:15',
    actualTime:         '08:15',       // no delay, arrived on time
    scheduledDeparture: '08:15',
    scheduledArrival:   '10:30',       // 2h 15min journey
    delay: 0,
    destination: 'North Station',
    driver: 'James K.',
    status: 'On Time'
  },
  {
    trainId: 'TR-202',
    line: 'Line B',
    scheduledTime:      '08:30',
    actualTime:         '08:40',       // 10 min late departure
    scheduledDeparture: '08:30',
    scheduledArrival:   '11:00',       // 2h 30min journey; arrives ~11:10 in reality
    delay: 10,
    destination: 'East Terminal',
    driver: 'Sara M.',
    status: 'Delayed'
  },
  {
    trainId: 'TR-303',
    line: 'Line C',
    scheduledTime:      '08:45',
    actualTime:         '09:10',       // 25 min late — matches the Signal Failure disruption
    scheduledDeparture: '08:45',
    scheduledArrival:   '12:15',       // 3h 30min journey; arrives ~12:40 in reality
    delay: 25,
    destination: 'Airport',
    driver: 'David L.',
    status: 'Delayed'
  },
  {
    trainId: 'TR-404',
    line: 'Line D',
    scheduledTime:      '09:00',
    actualTime:         '09:00',       // on time, not '--'
    scheduledDeparture: '09:00',
    scheduledArrival:   '11:30',       // 2h 30min journey
    delay: 0,
    destination: 'West End',
    driver: 'Nina P.',
    status: 'On Time'
  }
]);

  await User.insertMany([
    { name: 'Alice Johnson', email: 'alice@traintrack.com', role: 'admin',      active: true },
    { name: 'Bob Smith',     email: 'bob@traintrack.com',   role: 'controller', active: true },
    { name: 'Carol White',   email: 'carol@traintrack.com', role: 'passenger',  active: true },
    { name: 'Dan Brown',     email: 'dan@traintrack.com',   role: 'passenger',  active: false }
  ]);

  console.log('Database seeded!');
  mongoose.disconnect();
});
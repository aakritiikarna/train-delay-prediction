const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const connectDB = require('./config/db');
connectDB();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.set('io', io);  // ← add this line

// API routes
app.use('/api/disruptions', require('./routes/disruptions'));
app.use('/api/schedules',   require('./routes/schedules'));
app.use('/api/admin',       require('./routes/admin'));

// Page routes
app.get('/',           (req, res) => res.sendFile(path.join(__dirname, 'views/index.html')));
app.get('/login',      (req, res) => res.sendFile(path.join(__dirname, 'views/login.html')));
app.get('/passenger',  (req, res) => res.sendFile(path.join(__dirname, 'views/passenger.html')));
app.get('/controller', (req, res) => res.sendFile(path.join(__dirname, 'views/controller.html')));
app.get('/admin',      (req, res) => res.sendFile(path.join(__dirname, 'views/admin.html')));
app.get('/contact',    (req, res) => res.sendFile(path.join(__dirname, 'views/contact.html')));

// Socket.io
io.on('connection', socket => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
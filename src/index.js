const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const config = require('./config/config');
const socketService = require('./services/socketService');

// Route imports
const authRoutes = require('./routes/auth.routes');
const campaignRoutes = require('./routes/campaign.routes');
const chatRoutes = require('./routes/chat.routes');

// Initialize Express
const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = socketService.initializeSocket(server);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Make io available to routes
app.set('io', io);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/chat', chatRoutes);

// Connect to MongoDB
mongoose
  .connect(config.dbUri)
  .then(() => {
    console.log('Connected to MongoDB');

    // Start server
    const PORT = config.port || 3000;
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

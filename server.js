require('dotenv').config(); // مهم جدًا يكون أول سطر

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// CORS options - محدث للإنتاج
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:3001', 
    'http://localhost:19006',
    'https://scooters.modern-bns.com',
    'https://www.scooters.modern-bns.com',
    'https://master-bug-lucky-ngrok-free.app',
    /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
    /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
    /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+:\d+$/
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token']
};

app.use(cors(corsOptions));

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // للسماح بـ Socket.IO
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting للإنتاج
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: process.env.NODE_ENV === 'production' ? 100 : 1000, // 100 طلب في الإنتاج
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// MongoDB connection with better error handling
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000, // 30 seconds
  socketTimeoutMS: 45000, // 45 seconds
  maxPoolSize: 10,
  minPoolSize: 2,
  maxIdleTimeMS: 30000,
  waitQueueTimeoutMS: 30000,
  heartbeatFrequencyMS: 10000,
  retryWrites: true,
  retryReads: true,
  connectTimeoutMS: 30000
})
.then(() => console.log('✅ MongoDB connected successfully'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// Socket.IO configuration
const io = socketIo(server, {
  cors: {
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:19006',
      'https://scooters.modern-bns.com',
      'https://www.scooters.modern-bns.com',
      'https://master-bug-lucky-ngrok-free.app',
      /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
      /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
      /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+:\d+$/
    ],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('🔌 User disconnected:', socket.id);
  });
});

// Make io accessible to routes
app.set('io', io);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV 
  });
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/rides', require('./routes/rides'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/webhooks/paypal', require('./routes/paypalWebhook'));
app.use('/api/locations', require('./routes/locations'));
app.use('/api/pricing', require('./routes/pricing'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/map', require('./routes/map'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.stack);
  res.status(500).json({ 
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

const PORT = process.env.PORT || 5001;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  console.log(`🌐 API available at: ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
});

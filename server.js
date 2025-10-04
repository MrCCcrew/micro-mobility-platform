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

// ===================== أساسيات الشبكة =====================
app.set('trust proxy', 1); // مهم مع Cloudflare/Render للـ rate limit والـ IPs

// ===================== CORS =====================
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:19006',
    'https://scooters.modern-bns.com',
    'https://www.scooters.modern-bns.com',
    'https://api.scooters.modern-bns.com', // الدومين بتاع الـAPI
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
// دعم الـ preflight صراحةً
app.options('*', cors(corsOptions));

// ================== Security & Parsers ==================
app.use(helmet({
  contentSecurityPolicy: false, // للسماح بـ Socket.IO
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ================== Rate limiting ==================
// نطبق على /api و /wallet عشان ندعم الـ alias
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: process.env.NODE_ENV === 'production' ? 100 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.'
});
app.use(['/api', '/wallet'], limiter);

// ================== Logging ==================
app.use(process.env.NODE_ENV === 'development' ? morgan('dev') : morgan('combined'));

// ================== MongoDB ==================
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
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

// ================== Socket.IO ==================
const io = socketIo(server, {
  cors: {
    origin: corsOptions.origin,
    methods: ['GET', 'POST'],
    credentials: true
  }
});
io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);
  socket.on('disconnect', () => console.log('🔌 User disconnected:', socket.id));
});
app.set('io', io);

// ================== Health / Diagnostics ==================
// Health
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});
app.get('/healthz', (req, res) => res.status(200).send('OK'));
app.get('/api/health', (req, res) => res.status(200).send('OK-API'));
app.get('/api/healthz', (req, res) => res.status(200).send('OK-API'));

// قائمة بالمسارات للمساعدة في التشخيص
app.get('/__routes', (req, res) => {
  const list = [];
  const walk = (stack, base = '') => {
    stack.forEach((l) => {
      if (l.route && l.route.path) {
        Object.keys(l.route.methods).forEach(m => list.push(`${m.toUpperCase()} ${base}${l.route.path}`));
      } else if (l.name === 'router' && l.handle?.stack) {
        // nested router
        walk(l.handle.stack, base);
      }
    });
  };
  walk(app._router.stack);
  res.json(list);
});

// ================== API Routes (قبل 404) ==================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/rides', require('./routes/rides'));
app.use('/api/payments', require('./routes/payments'));

// Wallet routes + alias لتوافق التطبيقات القديمة
const walletRoutes = require('./routes/wallet');
app.use('/api/wallet', walletRoutes); // الجديد/الصحيح
app.use('/wallet', walletRoutes);     // alias للتطبيقات اللي بتطلب بدون /api

app.use('/api/locations', require('./routes/locations'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/webhooks/paypal', require('./routes/paypalWebhook'));
app.use('/api/pricing', require('./routes/pricing'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/map', require('./routes/map'));

// ================== Error handler ==================
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.stack || err);
  res.status(500).json({
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? (err.message || err) : 'Internal server error'
  });
});

// ================== 404 (لازم يكون في الآخر) ==================
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// ================== Start ==================
const PORT = process.env.PORT || 5001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  console.log(`🌐 API available at: ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
});

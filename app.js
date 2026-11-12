'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const pinoHttp = require('pino-http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('./models/User');

const createAuth = require('./middleware/auth');
const createLimiters = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const createMlClient = require('./services/mlClient');
const { createEmailService } = require('./services/email');
const createNotificationService = require('./services/notifications');

/**
 * Builds the Express app + Socket.io server without starting to listen, so tests can
 * drive it with supertest and server.js owns process concerns (ports, signals).
 */
function createApp(env, logger) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: env.corsOrigins.length ? { origin: env.corsOrigins, credentials: true } : undefined });
  const auth = createAuth(env);
  const limiters = createLimiters(env);
  const ml = createMlClient(env);
  const email = createEmailService(env, logger);
  const notifications = createNotificationService(io, email);

  app.set('io', io);
  app.set('notifications', notifications);
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", ...env.corsOrigins],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: env.isProd ? [] : null,
        },
      },
    })
  );
  if (env.corsOrigins.length) app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: env.isProd ? '1h' : 0 }));

  // Health check for load balancers / hosting platforms. `?deep=true` also pings the ML service.
  app.get('/health', async (req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    const body = { status: dbUp ? 'ok' : 'unavailable', db: dbUp ? 'connected' : 'disconnected', uptime: Math.round(process.uptime()) };
    if (req.query.deep === 'true') body.mlService = await ml.health();
    res.status(dbUp ? 200 : 503).json(body);
  });

  // API
  app.use('/api', limiters.api);
  app.use('/api/auth', require('./routes/auth')({ env, auth, limiters, email, notifications }));
  app.use('/api/notifications', require('./routes/notifications')({ auth, notifications }));
  app.use('/api/admin/notifications', require('./routes/admin-notifications')({ auth }));
  app.use('/api/disruptions', require('./routes/disruptions')({ auth, notifications }));
  app.use('/api/schedules', require('./routes/schedules')({ auth, notifications }));
  app.use('/api/operations', require('./routes/operations')({ auth }));
  app.use('/api/admin', require('./routes/admin')({ env, auth, ml }));
  app.use('/api', require('./routes/misc')({ limiters, ml, auth, notifications }));

  // Pages. Controller and admin dashboards are gated on the server, not just hidden in the UI.
  const view = (name) => (_req, res) => res.sendFile(path.join(__dirname, 'views', `${name}.html`), { dotfiles: 'allow' });
  app.get('/', view('index'));
  app.get('/login', view('login'));
  app.get('/passenger', view('passenger'));
  app.get('/contact', view('contact'));
  app.get('/controller', auth.pageGuard('controller', 'admin'), view('controller'));
  app.get('/admin', auth.pageGuard('admin'), view('admin'));

  io.on('connection', (socket) => {
    logger.debug({ id: socket.id }, 'socket connected');
    void (async () => {
      try {
        const cookieHeader = socket.handshake.headers.cookie || '';
        const tokenPair = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${auth.COOKIE}=`));
        if (!tokenPair) return;
        const token = decodeURIComponent(tokenPair.slice(auth.COOKIE.length + 1));
        const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
        const user = await User.findById(payload.sub);
        if (!user || !user.active || (payload.ver ?? 0) !== (user.sessionVersion || 0)) return;
        await socket.join(`user:${user._id}`);
        if (user.role === 'admin') await socket.join('role:admin');
      } catch (error) {
        if (error.name !== 'JsonWebTokenError' && error.name !== 'TokenExpiredError') {
          logger.warn({ id: socket.id, code: error.code || error.name }, 'Socket authentication failed');
        }
      }
    })();
  });

  app.use(notFound);
  app.use(errorHandler);
  return { app, server, io };
}

module.exports = createApp;

require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  dbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/benovo',
  jwtSecret: process.env.JWT_SECRET || 'your_dev_secret_key',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
};

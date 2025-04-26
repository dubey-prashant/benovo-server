const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const authMiddleware = require('../middleware/auth.middleware');

// All chat routes are protected
router.use(authMiddleware);

// Get messages for a campaign
router.get('/:campaignId', chatController.getMessages);

// Send a new message
router.post('/:campaignId', chatController.sendMessage);

module.exports = router;

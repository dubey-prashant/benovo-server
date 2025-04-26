const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/campaign.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Apply auth middleware to all campaign routes
router.use(authMiddleware);

router.post('/', campaignController.createCampaign);
router.get('/', campaignController.getUserCampaigns);
router.get('/:id', campaignController.getCampaignById);
router.post('/:id/invite', campaignController.inviteMember);

module.exports = router;

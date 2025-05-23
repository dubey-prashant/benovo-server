const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/campaign.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Apply auth middleware to all campaign routes
router.use(authMiddleware);

router.get('/invitations', campaignController.getUserInvitations);
router.post(
  '/invitations/:invitationId/respond',
  campaignController.respondToInvitation
);
// Existing routes
router.post('/', campaignController.createCampaign);
router.get('/', campaignController.getUserCampaigns);
router.get('/:id', campaignController.getCampaignById);
router.delete('/:id', campaignController.deleteCampaign);

// Invitation routes
router.post('/:id/invite', campaignController.inviteMember);
router.get('/:id/invitations', campaignController.getCampaignInvitations);
router.delete(
  '/:id/invitations/:invitationId',
  campaignController.cancelInvitation
);

// Member management routes
router.delete('/:id/members/:memberId', campaignController.removeMember);

// Update member allocation month
router.put(
  '/:id/members/:memberId/allocation',
  authMiddleware,
  campaignController.updateMemberAllocation
);

// Payment routes
router.post('/:id/contributions', campaignController.recordContribution);
router.get('/:id/contributions', campaignController.getCampaignContributions);
router.get('/contributions/user', campaignController.getUserContributions);

module.exports = router;

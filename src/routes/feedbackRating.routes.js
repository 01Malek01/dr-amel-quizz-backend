const express = require('express');
const { submit } = require('../controllers/feedbackRatingPublic.controller');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.post('/:code', submit);

module.exports = router;
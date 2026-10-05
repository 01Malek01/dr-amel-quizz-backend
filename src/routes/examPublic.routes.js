const express = require('express');
const {
  getMeta,
  start,
  submit,
  complete,
  submitPostSurvey,
} = require('../controllers/examPublic.controller');
const { protect, optionalAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/:code', optionalAuth, getMeta);
router.post('/:code/start', protect, start);
router.post('/:code/submit', protect, submit);
router.post('/:code/complete', protect, complete);
router.post('/:code/post-survey', protect, submitPostSurvey);

module.exports = router;
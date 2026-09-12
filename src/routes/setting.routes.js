const express = require('express');
const { getSetting, setSetting } = require('../controllers/setting.controller');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.use(protect, adminOnly);

router.get('/:key', getSetting);
router.put('/:key', setSetting);

module.exports = router;
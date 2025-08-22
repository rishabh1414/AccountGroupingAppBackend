const express = require("express");
const { protect } = require("../middlewares/authMiddleware");
const scheduleCtrl = require("../controllers/scheduleController");

const router = express.Router();
router.use(protect);

router.put("/schedule/global", scheduleCtrl.enableGlobal);
router.put("/schedule/parent/:parentId", scheduleCtrl.enableParent);
router.post("/schedule/disable", scheduleCtrl.disable);
router.get("/schedule/countdown", scheduleCtrl.countdown);
router.post("/schedule/run", scheduleCtrl.runNow);

module.exports = router;

// routes/call.js
const express = require("express");
const router = express.Router();
const CallLog = require("../models/CallLog");
const User = require("../models/User");
const Therapist = require("../models/Therapist");
const auth = require("../middleware/auth");

// Initiate call
router.post("/initiate", auth("user"), async (req, res) => {
  try {
    const { therapistId } = req.body;
    const userId = req.userId;

    // Check user balance
    const user = await User.findById(userId);
    if (user.coinBalance < 5) {
      return res.status(400).json({ error: "Insufficient coin balance" });
    }

    // Check therapist availability
    const therapist = await Therapist.findById(therapistId);
    if (!therapist || !therapist.isAvailable) {
      return res.status(400).json({ error: "Therapist not available" });
    }

    // Create call log
    const callLog = new CallLog({
      userId,
      therapistId,
      startTime: new Date(),
      status: "initiated",
    });
    await callLog.save();

    res.json({
      success: true,
      callId: callLog._id,
      roomId: `room-${callLog._id}`,
    });
  } catch (error) {
    console.error("Initiate call error:", error);
    res.status(500).json({ error: "Failed to initiate call" });
  }
});

// Answer call
router.post("/answer/:callId", auth("therapist"), async (req, res) => {
  try {
    const { callId } = req.params;

    const callLog = await CallLog.findByIdAndUpdate(
      callId,
      { status: "answered" },
      { new: true }
    );

    if (!callLog) {
      return res.status(404).json({ error: "Call not found" });
    }

    res.json({ success: true, callLog });
  } catch (error) {
    console.error("Answer call error:", error);
    res.status(500).json({ error: "Failed to answer call" });
  }
});

// End call
router.post("/end/:callId", auth(), async (req, res) => {
  try {
    const { callId } = req.params;
    const { endedBy } = req.body;

    const callLog = await CallLog.findById(callId);
    if (!callLog) {
      return res.status(404).json({ error: "Call not found" });
    }

    // Calculate duration and costs
    const endTime = new Date();
    const durationMinutes = Math.ceil((endTime - callLog.startTime) / 60000);
    const costInCoins = durationMinutes * 5;
    const therapistEarningsCoins = durationMinutes * 2.5;

    // Update call log
    callLog.endTime = endTime;
    callLog.durationMinutes = durationMinutes;
    callLog.costInCoins = costInCoins;
    callLog.therapistEarningsCoins = therapistEarningsCoins;
    callLog.status =
      endedBy === "user" ? "ended_by_user" : "ended_by_therapist";
    await callLog.save();

    // Update user balance
    await User.findByIdAndUpdate(callLog.userId, {
      $inc: { coinBalance: -costInCoins },
    });

    // Update therapist earnings
    await Therapist.findByIdAndUpdate(callLog.therapistId, {
      $inc: { totalEarningsCoins: therapistEarningsCoins },
    });

    res.json({ success: true, callLog });
  } catch (error) {
    console.error("End call error:", error);
    res.status(500).json({ error: "Failed to end call" });
  }
});

module.exports = router;

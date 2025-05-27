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

// End call - FIXED VERSION with proper calculations
router.post("/end/:callId", auth(), async (req, res) => {
  try {
    const { callId } = req.params;
    const { endedBy } = req.body;

    console.log(`Ending call ${callId}, ended by: ${endedBy}`);

    const callLog = await CallLog.findById(callId);
    if (!callLog) {
      return res.status(404).json({ error: "Call not found" });
    }

    // Prevent double processing
    if (callLog.status.includes("ended")) {
      console.log("Call already ended, skipping processing");
      return res.json({ success: true, callLog });
    }

    // Calculate duration and costs
    const endTime = new Date();
    const durationMinutes = Math.max(
      1,
      Math.ceil((endTime - callLog.startTime) / 60000)
    ); // Minimum 1 minute
    const costInCoins = durationMinutes * 5; // 5 coins per minute
    const therapistEarningsCoins = Math.floor(durationMinutes * 2.5); // 2.5 coins per minute for therapist

    console.log(
      `Call duration: ${durationMinutes} minutes, cost: ${costInCoins} coins, therapist earnings: ${therapistEarningsCoins} coins`
    );

    // Update call log
    const updatedCallLog = await CallLog.findByIdAndUpdate(
      callId,
      {
        endTime: endTime,
        durationMinutes: durationMinutes,
        costInCoins: costInCoins,
        therapistEarningsCoins: therapistEarningsCoins,
        status: endedBy === "user" ? "ended_by_user" : "ended_by_therapist",
      },
      { new: true }
    );

    // Update user balance - deduct coins
    const updatedUser = await User.findByIdAndUpdate(
      callLog.userId,
      { $inc: { coinBalance: -costInCoins } },
      { new: true }
    );

    console.log(
      `Updated user ${callLog.userId} balance: ${updatedUser.coinBalance} (deducted ${costInCoins})`
    );

    // Update therapist earnings - add coins
    const updatedTherapist = await Therapist.findByIdAndUpdate(
      callLog.therapistId,
      { $inc: { totalEarningsCoins: therapistEarningsCoins } },
      { new: true }
    );

    console.log(
      `Updated therapist ${callLog.therapistId} earnings: ${updatedTherapist.totalEarningsCoins} (added ${therapistEarningsCoins})`
    );

    res.json({
      success: true,
      callLog: updatedCallLog,
      userBalance: updatedUser.coinBalance,
      therapistEarnings: updatedTherapist.totalEarningsCoins,
    });
  } catch (error) {
    console.error("End call error:", error);
    res.status(500).json({ error: "Failed to end call" });
  }
});

// Get call details
router.get("/details/:callId", auth(), async (req, res) => {
  try {
    const { callId } = req.params;

    const callLog = await CallLog.findById(callId)
      .populate("userId", "phoneNumber coinBalance")
      .populate("therapistId", "name totalEarningsCoins");

    if (!callLog) {
      return res.status(404).json({ error: "Call not found" });
    }

    res.json({ success: true, callLog });
  } catch (error) {
    console.error("Get call details error:", error);
    res.status(500).json({ error: "Failed to get call details" });
  }
});

module.exports = router;

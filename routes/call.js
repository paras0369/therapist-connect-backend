// routes/call.js - Simplified without Firebase
const express = require("express");
const router = express.Router();
const CallLog = require("../models/CallLog");
const User = require("../models/User");
const Therapist = require("../models/Therapist");
const auth = require("../middleware/auth");

// Call types and pricing
const CALL_TYPES = {
  VOICE: "voice",
  VIDEO: "video",
};

const CALL_PRICING = {
  [CALL_TYPES.VOICE]: {
    costPerMinute: 5,
    therapistEarningsPerMinute: 2.5,
    minimumMinutes: 1,
  },
  [CALL_TYPES.VIDEO]: {
    costPerMinute: 8,
    therapistEarningsPerMinute: 4,
    minimumMinutes: 1,
  },
};

// Helper function to calculate call costs
const calculateCallCost = (duration, callType) => {
  const durationMinutes = Math.max(1, Math.ceil(duration / 60));
  const pricing = CALL_PRICING[callType] || CALL_PRICING[CALL_TYPES.VOICE];

  return {
    durationMinutes,
    costInCoins: durationMinutes * pricing.costPerMinute,
    therapistEarningsCoins: Math.floor(
      durationMinutes * pricing.therapistEarningsPerMinute
    ),
  };
};

// Initiate call
router.post("/initiate", auth("user"), async (req, res) => {
  try {
    const { therapistId, callType = CALL_TYPES.VOICE, zegoCallId } = req.body;
    const userId = req.userId;

    console.log("Call initiation request:", {
      userId,
      therapistId,
      callType,
      zegoCallId,
    });

    // Validate inputs
    if (!therapistId || !zegoCallId) {
      return res.status(400).json({
        error: "Missing required fields",
      });
    }

    // Check user balance
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const requiredCoins = CALL_PRICING[callType].costPerMinute;
    if (user.coinBalance < requiredCoins) {
      return res.status(400).json({
        error: "Insufficient coin balance",
        required: requiredCoins,
        current: user.coinBalance,
      });
    }

    // Check therapist availability
    const therapist = await Therapist.findById(therapistId);
    if (!therapist) {
      return res.status(404).json({ error: "Therapist not found" });
    }

    if (!therapist.isAvailable) {
      return res.status(400).json({
        error: "Therapist not available",
      });
    }

    // Check for existing active calls
    const existingCall = await CallLog.findOne({
      $or: [
        { userId, status: { $in: ["initiated", "answered"] } },
        { therapistId, status: { $in: ["initiated", "answered"] } },
      ],
    });

    if (existingCall) {
      return res.status(400).json({
        error: "Active call already exists",
      });
    }

    // Create call log
    const callLog = new CallLog({
      userId,
      therapistId,
      startTime: new Date(),
      status: "initiated",
      callType,
      zegoCallId,
      estimatedCost: CALL_PRICING[callType].costPerMinute,
    });

    await callLog.save();
    console.log("Call log created:", callLog._id);

    res.json({
      success: true,
      callId: callLog._id,
      roomId: `room-${callLog._id}`,
      zegoCallId,
      therapistName: therapist.name,
      callType,
      estimatedCost: CALL_PRICING[callType].costPerMinute,
    });
  } catch (error) {
    console.error("Initiate call error:", error);
    res.status(500).json({
      error: "Failed to initiate call",
      details: error.message,
    });
  }
});

// End call
router.post("/end/:callId", auth(), async (req, res) => {
  try {
    const { callId } = req.params;
    const { endedBy, duration } = req.body;

    console.log(`Ending call ${callId}:`, { endedBy, duration });

    const callLog = await CallLog.findById(callId)
      .populate("userId")
      .populate("therapistId");

    if (!callLog) {
      return res.status(404).json({ error: "Call not found" });
    }

    // Check if already ended
    if (callLog.status.includes("ended")) {
      return res.json({
        success: true,
        callLog,
        message: "Call already ended",
      });
    }

    // Calculate costs if call was answered
    let costData = {
      durationMinutes: 0,
      costInCoins: 0,
      therapistEarningsCoins: 0,
    };

    if (callLog.status === "answered" && duration > 0) {
      costData = calculateCallCost(duration, callLog.callType);
    }

    // Update call log
    await CallLog.findByIdAndUpdate(callId, {
      endTime: new Date(),
      actualDuration: duration || 0,
      durationMinutes: costData.durationMinutes,
      costInCoins: costData.costInCoins,
      therapistEarningsCoins: costData.therapistEarningsCoins,
      status: endedBy === "user" ? "ended_by_user" : "ended_by_therapist",
    });

    // Update balances if there was a cost
    if (costData.costInCoins > 0) {
      await User.findByIdAndUpdate(callLog.userId._id, {
        $inc: { coinBalance: -costData.costInCoins },
      });

      await Therapist.findByIdAndUpdate(callLog.therapistId._id, {
        $inc: { totalEarningsCoins: costData.therapistEarningsCoins },
      });
    }

    res.json({
      success: true,
      costData,
    });
  } catch (error) {
    console.error("End call error:", error);
    res.status(500).json({
      error: "Failed to end call",
      details: error.message,
    });
  }
});

// Other routes remain the same but without Firebase references...

module.exports = router;

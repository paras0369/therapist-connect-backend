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

// Webhook endpoint for WebRTC call events
router.post("/webhook/call-status", async (req, res) => {
  try {
    const { callID, status, duration, participants } = req.body;

    console.log("WebRTC webhook received:", {
      callID,
      status,
      duration,
      participants,
    });

    // Find the call log by callId
    const callLog = await CallLog.findOne({ callId: callID });

    if (!callLog) {
      console.log("Call log not found for callID:", callID);
      return res.status(200).json({ success: true });
    }

    // Update call status based on webhook event
    switch (status) {
      case "call_started":
        callLog.status = "answered";
        callLog.actualStartTime = new Date();
        break;

      case "call_ended":
        if (callLog.status === "answered" && duration > 0) {
          const costData = calculateCallCost(duration, callLog.callType);

          callLog.endTime = new Date();
          callLog.actualDuration = duration;
          callLog.durationMinutes = costData.durationMinutes;
          callLog.costInCoins = costData.costInCoins;
          callLog.therapistEarningsCoins = costData.therapistEarningsCoins;
          callLog.status = "ended_by_user";

          // Update balances
          await User.findByIdAndUpdate(callLog.userId, {
            $inc: { coinBalance: -costData.costInCoins },
          });

          await Therapist.findByIdAndUpdate(callLog.therapistId, {
            $inc: { totalEarningsCoins: costData.therapistEarningsCoins },
          });
        } else {
          callLog.status = "missed";
        }
        break;

      case "call_rejected":
        callLog.status = "rejected";
        break;

      case "call_timeout":
        callLog.status = "missed";
        break;
    }

    await callLog.save();
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create call log when call is initiated
router.post("/log-call", auth(), async (req, res) => {
  try {
    const { therapistId, callType = CALL_TYPES.VOICE, callId } = req.body;
    const userId = req.userId;

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

    // Create call log
    const callLog = new CallLog({
      userId,
      therapistId,
      startTime: new Date(),
      status: "initiated",
      callType,
      callId,
      estimatedCost: CALL_PRICING[callType].costPerMinute,
    });

    await callLog.save();

    res.json({
      success: true,
      callId: callLog._id,
      callId,
    });
  } catch (error) {
    console.error("Log call error:", error);
    res.status(500).json({
      error: "Failed to log call",
      details: error.message,
    });
  }
});

// Initiate call
router.post("/initiate", auth("user"), async (req, res) => {
  try {
    const { therapistId, callType = CALL_TYPES.VOICE, callId } = req.body;
    const userId = req.userId;

    console.log("Call initiation request:", {
      userId,
      therapistId,
      callType,
      callId,
      userRole: req.userRole,
      body: req.body,
    });

    // Validate inputs
    if (!therapistId || !callId) {
      console.log("Validation failed - missing fields:", { therapistId, callId });
      return res.status(400).json({
        error: "Missing required fields",
      });
    }

    // Validate ObjectId format
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(therapistId)) {
      console.log("Invalid therapistId format:", therapistId);
      return res.status(400).json({
        error: "Invalid therapist ID format",
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

    // Auto-cleanup stuck calls older than 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const cleanupResult = await CallLog.updateMany(
      {
        $or: [
          { userId, status: { $in: ["initiated", "answered"] } },
          { therapistId, status: { $in: ["initiated", "answered"] } },
        ],
        createdAt: { $lt: fiveMinutesAgo }
      },
      {
        status: "timeout_auto_cleanup",
        endTime: new Date(),
        endReason: "auto_cleanup_stuck_call"
      }
    );
    
    if (cleanupResult.modifiedCount > 0) {
      console.log(`Auto-cleanup: Cleaned up ${cleanupResult.modifiedCount} stuck calls`);
    }

    // Check for existing active calls (after cleanup)
    const existingCall = await CallLog.findOne({
      $or: [
        { userId, status: { $in: ["initiated", "answered"] } },
        { therapistId, status: { $in: ["initiated", "answered"] } },
      ],
    });

    if (existingCall) {
      console.log("Found active call:", existingCall.callId);
      return res.status(400).json({
        error: "Active call already exists",
        callId: existingCall.callId,
        status: existingCall.status,
        createdAt: existingCall.createdAt
      });
    }

    // Create call log
    const callLog = new CallLog({
      userId,
      therapistId,
      startTime: new Date(),
      status: "initiated",
      callType,
      callId,
      estimatedCost: CALL_PRICING[callType].costPerMinute,
    });

    await callLog.save();
    console.log("Call log created:", callLog._id);

    res.json({
      success: true,
      callId: callLog._id,
      roomId: `room-${callLog._id}`,
      callId,
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

    const callLog = await CallLog.findOne({ callId: callId })
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
    await CallLog.findOneAndUpdate({ callId: callId }, {
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

// Cleanup stuck calls
router.post("/cleanup-stuck-calls", auth(), async (req, res) => {
  try {
    const userId = req.userId;
    const userRole = req.userRole;

    console.log(`Cleaning up stuck calls for ${userRole}: ${userId}`);

    // Find ALL active calls for this user (more aggressive - clean up all active calls)
    const query = {
      status: { $in: ["initiated", "answered"] },
    };

    if (userRole === "user") {
      query.userId = userId;
    } else if (userRole === "therapist") {
      query.therapistId = userId;
    }

    console.log("Cleanup query:", query);

    const stuckCalls = await CallLog.find(query);
    console.log(`Found ${stuckCalls.length} active calls:`, stuckCalls.map(c => ({
      id: c._id,
      status: c.status,
      createdAt: c.createdAt,
      callId: c.callId
    })));
    
    if (stuckCalls.length === 0) {
      return res.json({ 
        success: true, 
        message: "No stuck calls found",
        cleanedCount: 0 
      });
    }

    // Update stuck calls to cancelled
    const result = await CallLog.updateMany(query, {
      status: "cancelled_by_user",
      endTime: new Date(),
      endReason: "cleanup",
    });

    console.log(`Cleaned up ${result.modifiedCount} stuck calls`);

    res.json({
      success: true,
      message: `Cleaned up ${result.modifiedCount} stuck calls`,
      cleanedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Cleanup error:", error);
    res.status(500).json({
      error: "Failed to cleanup calls",
      details: error.message,
    });
  }
});

// Force cleanup ALL stuck calls (admin endpoint)
router.post("/force-cleanup-all", async (req, res) => {
  try {
    console.log('Force cleanup all stuck calls requested');

    // Find all stuck calls
    const stuckCalls = await CallLog.find({
      status: { $in: ["initiated", "answered"] }
    });

    console.log(`Found ${stuckCalls.length} stuck calls`);

    if (stuckCalls.length === 0) {
      return res.json({
        success: true,
        message: "No stuck calls found",
        cleanedCount: 0
      });
    }

    // Update all stuck calls
    const result = await CallLog.updateMany(
      { status: { $in: ["initiated", "answered"] } },
      {
        status: "cancelled_by_user",
        endTime: new Date(),
        endReason: "force_cleanup"
      }
    );

    console.log(`Force cleaned up ${result.modifiedCount} calls`);

    res.json({
      success: true,
      message: `Force cleaned up ${result.modifiedCount} calls`,
      cleanedCount: result.modifiedCount
    });
  } catch (error) {
    console.error("Force cleanup error:", error);
    res.status(500).json({
      error: "Failed to force cleanup",
      details: error.message
    });
  }
});

// Get active calls for debugging
router.get("/active-calls", auth(), async (req, res) => {
  try {
    const userId = req.userId;
    const userRole = req.userRole;

    const query = {
      status: { $in: ["initiated", "answered"] },
    };

    if (userRole === "user") {
      query.userId = userId;
    } else if (userRole === "therapist") {
      query.therapistId = userId;
    }

    const activeCalls = await CallLog.find(query)
      .populate("userId", "phoneNumber")
      .populate("therapistId", "name")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      activeCalls,
      count: activeCalls.length,
    });
  } catch (error) {
    console.error("Get active calls error:", error);
    res.status(500).json({
      error: "Failed to get active calls",
      details: error.message,
    });
  }
});


module.exports = router;

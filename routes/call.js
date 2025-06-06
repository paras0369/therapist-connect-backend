// Enhanced backend/routes/call.js - Fixed with better error handling
const express = require("express");
const router = express.Router();
const CallLog = require("../models/CallLog");
const User = require("../models/User");
const Therapist = require("../models/Therapist");
const auth = require("../middleware/auth");
const FirebaseNotificationService = require("../services/firebaseAdmin");

// Call types enum
const CALL_TYPES = {
  VOICE: "voice",
  VIDEO: "video",
};

// Call pricing configuration
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

// Enhanced initiate call with better validation and error handling
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

    // Validate required fields
    if (!therapistId) {
      return res.status(400).json({
        error: "Therapist ID is required",
      });
    }

    // Validate call type
    if (!Object.values(CALL_TYPES).includes(callType)) {
      return res.status(400).json({
        error: "Invalid call type",
        validTypes: Object.values(CALL_TYPES),
      });
    }

    // Validate ZegoCloud call ID
    if (!zegoCallId) {
      return res.status(400).json({
        error: "ZegoCloud call ID is required",
      });
    }

    // Check if user exists and get current balance
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const requiredCoins = CALL_PRICING[callType].costPerMinute;
    if (user.coinBalance < requiredCoins) {
      return res.status(400).json({
        error: "Insufficient coin balance",
        required: requiredCoins,
        current: user.coinBalance,
        callType,
      });
    }

    // Check if therapist exists and is available
    const therapist = await Therapist.findById(therapistId);
    if (!therapist) {
      return res.status(404).json({
        error: "Therapist not found",
      });
    }

    if (!therapist.isAvailable) {
      return res.status(400).json({
        error: "Therapist not available",
        therapistStatus: "offline",
      });
    }

    // Check if user already has an active call
    const existingCall = await CallLog.findOne({
      userId,
      status: { $in: ["initiated", "answered"] },
    });

    if (existingCall) {
      return res.status(400).json({
        error: "You already have an active call",
        activeCallId: existingCall._id,
      });
    }

    // Check if therapist is already in a call
    const therapistActiveCall = await CallLog.findOne({
      therapistId,
      status: { $in: ["initiated", "answered"] },
    });

    if (therapistActiveCall) {
      return res.status(400).json({
        error: "Therapist is currently busy",
        status: "busy",
      });
    }

    // Create call log with ZegoCloud integration
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

    // Set call timeout (30 seconds) - mark as missed if not answered
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(async () => {
        try {
          const call = await CallLog.findById(callLog._id);
          if (call && call.status === "initiated") {
            await CallLog.findByIdAndUpdate(callLog._id, {
              status: "missed",
              endTime: new Date(),
            });
            console.log(`Call ${callLog._id} marked as missed due to timeout`);
          }
          resolve();
        } catch (error) {
          console.error("Error handling call timeout:", error);
          resolve();
        }
      }, 30000);
    });

    // Don't await the timeout promise, let it run in background
    timeoutPromise.catch((error) => {
      console.error("Error in timeout promise:", error);
    });

    // Send push notification to therapist
    let notificationSent = false;
    try {
      if (therapist.fcmToken) {
        const notificationData = {
          type: "incoming_call",
          userId: userId,
          userName: user.phoneNumber || "User",
          roomId: `room-${callLog._id}`,
          callId: callLog._id.toString(),
          zegoCallId: zegoCallId, // Ensure this is always included
          callType,
          therapistId: therapistId,
          timestamp: Date.now().toString(),
        };

        console.log("Sending push notification with data:", notificationData);

        // Validate that zegoCallId is present before sending
        if (!notificationData.zegoCallId) {
          console.error("zegoCallId is missing from notification data!");
          throw new Error("zegoCallId is required for call notifications");
        }

        await FirebaseNotificationService.sendCallNotification(
          therapist.fcmToken,
          notificationData
        );

        notificationSent = true;
        console.log(
          "Push notification sent successfully to therapist with zegoCallId:",
          zegoCallId
        );
      } else {
        console.warn("Therapist FCM token not available");
      }
    } catch (notificationError) {
      console.error("Error sending push notification:", notificationError);
      // Don't fail the call initiation if notification fails, but log the issue
    }

    res.json({
      success: true,
      callId: callLog._id,
      roomId: `room-${callLog._id}`,
      zegoCallId,
      therapistName: therapist.name,
      callType,
      estimatedCost: CALL_PRICING[callType].costPerMinute,
      notificationSent,
    });
  } catch (error) {
    console.error("Initiate call error:", error);
    res.status(500).json({
      error: "Failed to initiate call",
      details: error.message,
    });
  }
});

// Enhanced answer call with better validation
router.post("/answer/:callId", auth("therapist"), async (req, res) => {
  try {
    const { callId } = req.params;
    const therapistId = req.userId;

    console.log("Call answer request:", { callId, therapistId });

    // Validate callId format
    if (!callId || !callId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: "Invalid call ID format" });
    }

    const callLog = await CallLog.findById(callId);
    if (!callLog) {
      return res.status(404).json({ error: "Call not found" });
    }

    if (callLog.therapistId.toString() !== therapistId) {
      return res
        .status(403)
        .json({ error: "Unauthorized to answer this call" });
    }

    if (callLog.status !== "initiated") {
      return res.status(400).json({
        error: "Call cannot be answered",
        currentStatus: callLog.status,
        reason:
          callLog.status === "missed"
            ? "Call has timed out"
            : callLog.status === "answered"
            ? "Call already answered"
            : "Call is no longer available",
      });
    }

    // Check if therapist is still available
    const therapist = await Therapist.findById(therapistId);
    if (!therapist) {
      return res.status(404).json({ error: "Therapist not found" });
    }

    if (!therapist.isAvailable) {
      return res.status(400).json({
        error: "Therapist is no longer available",
      });
    }

    const updatedCall = await CallLog.findByIdAndUpdate(
      callId,
      {
        status: "answered",
        actualStartTime: new Date(),
      },
      { new: true }
    );

    console.log("Call answered successfully:", updatedCall._id);

    res.json({
      success: true,
      callLog: updatedCall,
      roomId: `room-${callId}`,
      zegoCallId: updatedCall.zegoCallId,
      callType: updatedCall.callType,
    });
  } catch (error) {
    console.error("Answer call error:", error);
    res.status(500).json({
      error: "Failed to answer call",
      details: error.message,
    });
  }
});

// Enhanced reject call
router.post("/reject/:callId", auth("therapist"), async (req, res) => {
  try {
    const { callId } = req.params;
    const { reason = "rejected" } = req.body;
    const therapistId = req.userId;

    console.log("Call reject request:", { callId, therapistId, reason });

    // Validate callId format
    if (!callId || !callId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: "Invalid call ID format" });
    }

    const callLog = await CallLog.findById(callId);
    if (!callLog) {
      return res.status(404).json({ error: "Call not found" });
    }

    if (callLog.therapistId.toString() !== therapistId) {
      return res
        .status(403)
        .json({ error: "Unauthorized to reject this call" });
    }

    if (callLog.status !== "initiated") {
      return res.status(400).json({
        error: "Call cannot be rejected",
        currentStatus: callLog.status,
      });
    }

    await CallLog.findByIdAndUpdate(callId, {
      status: "rejected",
      endTime: new Date(),
      rejectReason: reason,
    });

    console.log("Call rejected successfully:", callId);

    res.json({ success: true, reason });
  } catch (error) {
    console.error("Reject call error:", error);
    res.status(500).json({
      error: "Failed to reject call",
      details: error.message,
    });
  }
});

// Enhanced cancel call (by user)
router.post("/cancel/:callId", auth("user"), async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.userId;

    console.log("Call cancel request:", { callId, userId });

    // Validate callId format
    if (!callId || !callId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: "Invalid call ID format" });
    }

    const callLog = await CallLog.findById(callId);
    if (!callLog) {
      return res.status(404).json({ error: "Call not found" });
    }

    if (callLog.userId.toString() !== userId) {
      return res
        .status(403)
        .json({ error: "Unauthorized to cancel this call" });
    }

    if (!["initiated", "answered"].includes(callLog.status)) {
      return res.status(400).json({
        error: "Call cannot be cancelled",
        currentStatus: callLog.status,
      });
    }

    await CallLog.findByIdAndUpdate(callId, {
      status: "cancelled_by_user",
      endTime: new Date(),
    });

    console.log("Call cancelled successfully:", callId);

    res.json({ success: true });
  } catch (error) {
    console.error("Cancel call error:", error);
    res.status(500).json({
      error: "Failed to cancel call",
      details: error.message,
    });
  }
});

// Enhanced end call with comprehensive error handling and transaction safety
router.post("/end/:callId", auth(), async (req, res) => {
  try {
    const { callId } = req.params;
    const { endedBy, duration, zegoCallId, reason = "ended" } = req.body;

    console.log(`Ending call ${callId}:`, {
      endedBy,
      duration,
      zegoCallId,
      reason,
    });

    // Validate callId format
    if (!callId || !callId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: "Invalid call ID format" });
    }

    // Validate required fields
    if (!endedBy) {
      return res.status(400).json({ error: "endedBy is required" });
    }

    if (!["user", "therapist"].includes(endedBy)) {
      return res.status(400).json({ error: "Invalid endedBy value" });
    }

    const callLog = await CallLog.findById(callId)
      .populate("userId", "fcmToken phoneNumber coinBalance")
      .populate("therapistId", "fcmToken name totalEarningsCoins");

    if (!callLog) {
      return res.status(404).json({ error: "Call not found" });
    }

    // Prevent double processing with more specific checks
    if (
      callLog.status.includes("ended") ||
      callLog.status === "cancelled_by_user"
    ) {
      console.log("Call already processed, returning cached result");
      return res.json({
        success: true,
        callLog,
        message: "Call already ended",
      });
    }

    // Validate user authorization
    const { userRole, userId } = req;
    if (userRole === "user" && callLog.userId._id.toString() !== userId) {
      return res.status(403).json({ error: "Unauthorized to end this call" });
    }

    if (
      userRole === "therapist" &&
      callLog.therapistId._id.toString() !== userId
    ) {
      return res.status(403).json({ error: "Unauthorized to end this call" });
    }

    // Validate ZegoCloud call ID if provided
    if (zegoCallId && callLog.zegoCallId && callLog.zegoCallId !== zegoCallId) {
      console.warn("ZegoCloud call ID mismatch:", {
        expected: callLog.zegoCallId,
        received: zegoCallId,
      });
    }

    // Calculate duration and costs
    const endTime = new Date();
    let actualDuration = duration;

    // Fallback duration calculation if not provided
    if (actualDuration === null || actualDuration === undefined) {
      const startTime = callLog.actualStartTime || callLog.startTime;
      actualDuration = Math.max(0, Math.floor((endTime - startTime) / 1000));
    }

    // Ensure duration is a valid number
    actualDuration = Math.max(0, parseInt(actualDuration) || 0);
    console.log(`Call duration: ${actualDuration} seconds`);

    let costData = {
      durationMinutes: 0,
      costInCoins: 0,
      therapistEarningsCoins: 0,
    };

    // Only charge if call was actually answered and had meaningful duration
    const shouldCharge = callLog.status === "answered" && actualDuration > 0;
    if (shouldCharge) {
      costData = calculateCallCost(actualDuration, callLog.callType);
      console.log("Cost calculation:", costData);

      // Validate user has sufficient balance for the actual cost
      if (costData.costInCoins > callLog.userId.coinBalance) {
        console.warn("User doesn't have sufficient balance for actual cost:", {
          required: costData.costInCoins,
          available: callLog.userId.coinBalance,
        });
        // Still process the call but charge what they have
        costData.costInCoins = Math.min(
          costData.costInCoins,
          callLog.userId.coinBalance
        );
        costData.therapistEarningsCoins = Math.floor(
          costData.costInCoins * 0.5
        ); // 50% to therapist
      }
    }

    // Update call log first
    const updatedCallLog = await CallLog.findByIdAndUpdate(
      callId,
      {
        endTime: endTime,
        actualDuration: actualDuration,
        durationMinutes: costData.durationMinutes,
        costInCoins: costData.costInCoins,
        therapistEarningsCoins: costData.therapistEarningsCoins,
        status: endedBy === "user" ? "ended_by_user" : "ended_by_therapist",
        endReason: reason,
      },
      { new: true }
    );

    let updatedUser = null;
    let updatedTherapist = null;

    // Update balances only if there was a cost
    if (costData.costInCoins > 0) {
      try {
        // Update user balance - deduct coins
        updatedUser = await User.findByIdAndUpdate(
          callLog.userId._id,
          { $inc: { coinBalance: -costData.costInCoins } },
          { new: true }
        );

        if (!updatedUser) {
          throw new Error("Failed to update user balance");
        }

        console.log(
          `Updated user ${callLog.userId._id} balance: ${updatedUser.coinBalance} (deducted ${costData.costInCoins})`
        );

        // Update therapist earnings - add coins
        updatedTherapist = await Therapist.findByIdAndUpdate(
          callLog.therapistId._id,
          { $inc: { totalEarningsCoins: costData.therapistEarningsCoins } },
          { new: true }
        );

        if (!updatedTherapist) {
          throw new Error("Failed to update therapist earnings");
        }

        console.log(
          `Updated therapist ${callLog.therapistId._id} earnings: ${updatedTherapist.totalEarningsCoins} (added ${costData.therapistEarningsCoins})`
        );
      } catch (balanceError) {
        console.error("Error updating balances:", balanceError);
        // Log the error but don't fail the entire request
        // The call was still completed successfully
      }
    } else {
      // Get current balances without updating
      updatedUser = await User.findById(callLog.userId._id);
      updatedTherapist = await Therapist.findById(callLog.therapistId._id);
      console.log("No charges applied - call too short or not answered");
    }

    // Send notifications to both user and therapist
    const notificationPromises = [];

    try {
      // Notify user about call ending and charges
      if (callLog.userId.fcmToken) {
        const userNotificationPromise =
          FirebaseNotificationService.sendCallEndedNotification(
            callLog.userId.fcmToken,
            {
              callId: callId,
              duration: costData.durationMinutes.toString(),
              cost: costData.costInCoins.toString(),
              callType: callLog.callType,
            }
          )
            .then(() => {
              console.log("Call ended notification sent to user");
            })
            .catch((error) => {
              console.error("Error sending notification to user:", error);
            });

        notificationPromises.push(userNotificationPromise);
      }

      // Notify therapist about earnings (only if they earned something)
      if (costData.therapistEarningsCoins > 0 && callLog.therapistId.fcmToken) {
        const therapistNotificationPromise =
          FirebaseNotificationService.sendTherapistNotification(
            callLog.therapistId.fcmToken,
            {
              title: "Session Completed",
              body: `You earned ${costData.therapistEarningsCoins} coins from your ${callLog.callType} session`,
              data: {
                type: "session_completed",
                callId: callId,
                earnings: costData.therapistEarningsCoins.toString(),
                duration: costData.durationMinutes.toString(),
                callType: callLog.callType,
              },
            }
          )
            .then(() => {
              console.log("Session completed notification sent to therapist");
            })
            .catch((error) => {
              console.error("Error sending notification to therapist:", error);
            });

        notificationPromises.push(therapistNotificationPromise);
      }

      // Wait for all notifications to complete (but don't fail if they don't)
      if (notificationPromises.length > 0) {
        Promise.allSettled(notificationPromises).then((results) => {
          console.log("Notification results:", results);
        });
      }
    } catch (notificationError) {
      console.error("Error setting up notifications:", notificationError);
      // Don't fail the request if notifications fail
    }

    res.json({
      success: true,
      callLog: updatedCallLog,
      userBalance: updatedUser?.coinBalance,
      therapistEarnings: updatedTherapist?.totalEarningsCoins,
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

// Get active calls for user/therapist with ZegoCloud info
router.get("/active", auth(), async (req, res) => {
  try {
    const { userRole, userId } = req;

    let query = { status: { $in: ["initiated", "answered"] } };

    if (userRole === "user") {
      query.userId = userId;
    } else if (userRole === "therapist") {
      query.therapistId = userId;
    }

    const activeCalls = await CallLog.find(query)
      .populate("userId", "phoneNumber")
      .populate("therapistId", "name")
      .sort({ startTime: -1 });

    res.json({
      success: true,
      activeCalls: activeCalls.map((call) => ({
        ...call.toObject(),
        estimatedCostPerMinute: CALL_PRICING[call.callType]?.costPerMinute || 5,
        estimatedEarningsPerMinute:
          CALL_PRICING[call.callType]?.therapistEarningsPerMinute || 2.5,
      })),
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

// Get call details with enhanced info including ZegoCloud data
router.get("/details/:callId", auth(), async (req, res) => {
  try {
    const { callId } = req.params;

    // Validate callId format
    if (!callId || !callId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: "Invalid call ID format" });
    }

    const callLog = await CallLog.findById(callId)
      .populate("userId", "phoneNumber coinBalance")
      .populate("therapistId", "name totalEarningsCoins");

    if (!callLog) {
      return res.status(404).json({ error: "Call not found" });
    }

    // Calculate real-time duration if call is active
    let currentDuration = callLog.actualDuration || 0;
    if (["initiated", "answered"].includes(callLog.status)) {
      const now = new Date();
      const startTime = callLog.actualStartTime || callLog.startTime;
      currentDuration = Math.ceil((now - startTime) / 1000);
    }

    // Calculate real-time cost
    const realTimeCost =
      callLog.status === "answered" && currentDuration > 0
        ? calculateCallCost(currentDuration, callLog.callType)
        : { durationMinutes: 0, costInCoins: 0, therapistEarningsCoins: 0 };

    res.json({
      success: true,
      callLog: {
        ...callLog.toObject(),
        currentDuration,
        realTimeCost,
        callTypeInfo: {
          type: callLog.callType,
          costPerMinute: CALL_PRICING[callLog.callType]?.costPerMinute || 5,
          earningsPerMinute:
            CALL_PRICING[callLog.callType]?.therapistEarningsPerMinute || 2.5,
        },
      },
    });
  } catch (error) {
    console.error("Get call details error:", error);
    res.status(500).json({
      error: "Failed to get call details",
      details: error.message,
    });
  }
});

// New endpoint to get call statistics by type
router.get("/stats/by-type", auth(), async (req, res) => {
  try {
    const { userRole, userId } = req;

    let matchQuery = {
      status: { $in: ["ended_by_user", "ended_by_therapist"] },
    };

    if (userRole === "user") {
      matchQuery.userId = userId;
    } else if (userRole === "therapist") {
      matchQuery.therapistId = userId;
    }

    const stats = await CallLog.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: "$callType",
          totalCalls: { $sum: 1 },
          totalMinutes: { $sum: "$durationMinutes" },
          totalCost: { $sum: "$costInCoins" },
          totalEarnings: { $sum: "$therapistEarningsCoins" },
          avgDuration: { $avg: "$durationMinutes" },
        },
      },
    ]);

    const formattedStats = {
      [CALL_TYPES.VOICE]: {
        totalCalls: 0,
        totalMinutes: 0,
        totalCost: 0,
        totalEarnings: 0,
        avgDuration: 0,
      },
      [CALL_TYPES.VIDEO]: {
        totalCalls: 0,
        totalMinutes: 0,
        totalCost: 0,
        totalEarnings: 0,
        avgDuration: 0,
      },
    };

    stats.forEach((stat) => {
      if (formattedStats[stat._id]) {
        formattedStats[stat._id] = {
          totalCalls: stat.totalCalls,
          totalMinutes: stat.totalMinutes,
          totalCost: stat.totalCost,
          totalEarnings: stat.totalEarnings,
          avgDuration: Math.round(stat.avgDuration || 0),
        };
      }
    });

    res.json({
      success: true,
      statsByType: formattedStats,
      callTypes: CALL_TYPES,
      pricing: CALL_PRICING,
    });
  } catch (error) {
    console.error("Get call stats by type error:", error);
    res.status(500).json({
      error: "Failed to get call statistics",
      details: error.message,
    });
  }
});

module.exports = router;

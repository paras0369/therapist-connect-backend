// Enhanced backend/routes/call.js - Better call flow management
const express = require("express");
const router = express.Router();
const CallLog = require("../models/CallLog");
const User = require("../models/User");
const Therapist = require("../models/Therapist");
const auth = require("../middleware/auth");
const FirebaseNotificationService = require("../services/firebaseAdmin");

// Initiate call with improved validation
router.post("/initiate", auth("user"), async (req, res) => {
  try {
    const { therapistId } = req.body;
    const userId = req.userId;

    // Check user balance
    const user = await User.findById(userId);
    if (user.coinBalance < 5) {
      return res.status(400).json({
        error: "Insufficient coin balance",
        required: 5,
        current: user.coinBalance,
      });
    }

    // Check therapist availability
    const therapist = await Therapist.findById(therapistId);
    if (!therapist || !therapist.isAvailable) {
      return res.status(400).json({
        error: "Therapist not available",
        therapistStatus: therapist ? "offline" : "not_found",
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

    // Create call log
    const callLog = new CallLog({
      userId,
      therapistId,
      startTime: new Date(),
      status: "initiated",
    });
    await callLog.save();

    // Set call timeout (30 seconds)
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
      } catch (error) {
        console.error("Error handling call timeout:", error);
      }
    }, 30000);

    res.json({
      success: true,
      callId: callLog._id,
      roomId: `room-${callLog._id}`,
      therapistName: therapist.name,
    });
  } catch (error) {
    console.error("Initiate call error:", error);
    res.status(500).json({ error: "Failed to initiate call" });
  }
});

// Answer call with validation
router.post("/answer/:callId", auth("therapist"), async (req, res) => {
  try {
    const { callId } = req.params;
    const therapistId = req.userId;

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
      });
    }

    const updatedCall = await CallLog.findByIdAndUpdate(
      callId,
      {
        status: "answered",
        actualStartTime: new Date(), // Track when call actually started
      },
      { new: true }
    );

    res.json({
      success: true,
      callLog: updatedCall,
      roomId: `room-${callId}`,
    });
  } catch (error) {
    console.error("Answer call error:", error);
    res.status(500).json({ error: "Failed to answer call" });
  }
});

// Reject call
router.post("/reject/:callId", auth("therapist"), async (req, res) => {
  try {
    const { callId } = req.params;
    const therapistId = req.userId;

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
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Reject call error:", error);
    res.status(500).json({ error: "Failed to reject call" });
  }
});

// Cancel call (by user)
router.post("/cancel/:callId", auth("user"), async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.userId;

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

    res.json({ success: true });
  } catch (error) {
    console.error("Cancel call error:", error);
    res.status(500).json({ error: "Failed to cancel call" });
  }
});

// Enhanced end call with better calculation
router.post("/end/:callId", auth(), async (req, res) => {
  try {
    const { callId } = req.params;
    const { endedBy } = req.body;

    console.log(`Ending call ${callId}, ended by: ${endedBy}`);

    const callLog = await CallLog.findById(callId)
      .populate("userId", "fcmToken phoneNumber")
      .populate("therapistId", "fcmToken name");

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
      callLog.userId._id,
      { $inc: { coinBalance: -costInCoins } },
      { new: true }
    );

    console.log(
      `Updated user ${callLog.userId._id} balance: ${updatedUser.coinBalance} (deducted ${costInCoins})`
    );

    // Update therapist earnings - add coins
    const updatedTherapist = await Therapist.findByIdAndUpdate(
      callLog.therapistId._id,
      { $inc: { totalEarningsCoins: therapistEarningsCoins } },
      { new: true }
    );

    console.log(
      `Updated therapist ${callLog.therapistId._id} earnings: ${updatedTherapist.totalEarningsCoins} (added ${therapistEarningsCoins})`
    );

    // Send notifications to both user and therapist
    try {
      // Notify user about call ending and charges
      if (
        callLog.userId.fcmToken &&
        FirebaseNotificationService.isUserAppReady()
      ) {
        await FirebaseNotificationService.sendCallEndedNotification(
          callLog.userId.fcmToken,
          {
            callId: callId,
            duration: durationMinutes.toString(),
            cost: costInCoins.toString(),
          }
        );
        console.log("Call ended notification sent to user");
      }

      // Notify therapist about earnings
      if (
        callLog.therapistId.fcmToken &&
        FirebaseNotificationService.isTherapistAppReady()
      ) {
        await FirebaseNotificationService.sendTherapistNotification(
          callLog.therapistId.fcmToken,
          {
            title: "Session Completed",
            body: `You earned ${therapistEarningsCoins} coins from your session`,
            data: {
              type: "session_completed",
              callId: callId,
              earnings: therapistEarningsCoins.toString(),
              duration: durationMinutes.toString(),
            },
          }
        );
        console.log("Session completed notification sent to therapist");
      }
    } catch (notificationError) {
      console.error("Error sending end call notifications:", notificationError);
      // Don't fail the request if notifications fail
    }

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

// Get active calls for user/therapist
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
      activeCalls,
      count: activeCalls.length,
    });
  } catch (error) {
    console.error("Get active calls error:", error);
    res.status(500).json({ error: "Failed to get active calls" });
  }
});

// Get call details with enhanced info
router.get("/details/:callId", auth(), async (req, res) => {
  try {
    const { callId } = req.params;

    const callLog = await CallLog.findById(callId)
      .populate("userId", "phoneNumber coinBalance")
      .populate("therapistId", "name totalEarningsCoins");

    if (!callLog) {
      return res.status(404).json({ error: "Call not found" });
    }

    // Calculate real-time duration if call is active
    let currentDuration = callLog.durationMinutes;
    if (["initiated", "answered"].includes(callLog.status)) {
      const now = new Date();
      const startTime = callLog.actualStartTime || callLog.startTime;
      currentDuration = Math.ceil((now - startTime) / 60000);
    }

    res.json({
      success: true,
      callLog: {
        ...callLog.toObject(),
        currentDuration,
      },
    });
  } catch (error) {
    console.error("Get call details error:", error);
    res.status(500).json({ error: "Failed to get call details" });
  }
});

module.exports = router;

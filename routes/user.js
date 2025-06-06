const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const User = require("../models/User");
const Therapist = require("../models/Therapist");
const CallLog = require("../models/CallLog");
const auth = require("../middleware/auth");

// Get available therapists
router.get("/therapists", auth("user"), async (req, res) => {
  try {
    const therapists = await Therapist.find({ isAvailable: true }).select(
      "name _id"
    );

    res.json({ therapists });
  } catch (error) {
    console.error("Get therapists error:", error);
    res.status(500).json({ error: "Failed to fetch therapists" });
  }
});

// Get user profile - ENHANCED with real-time data
router.get("/profile", auth("user"), async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-otp -otpExpiry");

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get additional stats
    const totalCalls = await CallLog.countDocuments({
      userId: req.userId,
      status: { $in: ["ended_by_user", "ended_by_therapist"] },
    });

    const totalSpentResult = await CallLog.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(req.userId),
          status: { $in: ["ended_by_user", "ended_by_therapist"] },
        },
      },
      { $group: { _id: null, totalSpent: { $sum: "$costInCoins" } } },
    ]);

    const totalSpent = totalSpentResult[0]?.totalSpent || 0;

    res.json({
      user: {
        ...user.toObject(),
        totalCalls,
        totalSpent,
      },
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// Get user call history - ENHANCED with better data
router.get("/call-history", auth("user"), async (req, res) => {
  try {
    const calls = await CallLog.find({
      userId: req.userId,
      status: {
        $in: ["ended_by_user", "ended_by_therapist", "missed", "rejected"],
      },
    })
      .populate("therapistId", "name")
      .sort({ startTime: -1 })
      .limit(50);

    res.json({ calls });
  } catch (error) {
    console.error("Get call history error:", error);
    res.status(500).json({ error: "Failed to fetch call history" });
  }
});

// Get user statistics - ENHANCED with real-time calculations
router.get("/stats", auth("user"), async (req, res) => {
  try {
    const userId = req.userId;

    // Total calls made
    const totalCalls = await CallLog.countDocuments({
      userId,
      status: { $in: ["ended_by_user", "ended_by_therapist"] },
    });

    // Total coins spent
    const spentResult = await CallLog.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          status: { $in: ["ended_by_user", "ended_by_therapist"] },
        },
      },
      { $group: { _id: null, totalSpent: { $sum: "$costInCoins" } } },
    ]);
    const totalCoinsSpent = spentResult[0]?.totalSpent || 0;

    // Total minutes
    const minutesResult = await CallLog.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          status: { $in: ["ended_by_user", "ended_by_therapist"] },
        },
      },
      { $group: { _id: null, totalMinutes: { $sum: "$durationMinutes" } } },
    ]);
    const totalMinutes = minutesResult[0]?.totalMinutes || 0;

    // This month's activity
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyResult = await CallLog.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          startTime: { $gte: startOfMonth },
          status: { $in: ["ended_by_user", "ended_by_therapist"] },
        },
      },
      {
        $group: {
          _id: null,
          monthlyMinutes: { $sum: "$durationMinutes" },
          monthlyCalls: { $sum: 1 },
          monthlySpent: { $sum: "$costInCoins" },
        },
      },
    ]);

    const monthlyStats = monthlyResult[0] || {
      monthlyMinutes: 0,
      monthlyCalls: 0,
      monthlySpent: 0,
    };

    // Get current balance
    const user = await User.findById(userId).select("coinBalance");

    res.json({
      totalCalls,
      totalCoinsSpent,
      totalMinutes,
      currentBalance: user.coinBalance,
      ...monthlyStats,
    });
  } catch (error) {
    console.error("Get user stats error:", error);
    res.status(500).json({ error: "Failed to fetch user statistics" });
  }
});

// Add coin balance endpoint for real-time updates
router.get("/balance", auth("user"), async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("coinBalance");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      success: true,
      coinBalance: user.coinBalance,
    });
  } catch (error) {
    console.error("Get balance error:", error);
    res.status(500).json({ error: "Failed to fetch balance" });
  }
});

module.exports = router;

// routes/therapist.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Therapist = require("../models/Therapist");
const CallLog = require("../models/CallLog");
const auth = require("../middleware/auth");

// Get therapist profile
router.get("/profile", auth("therapist"), async (req, res) => {
  try {
    const therapist = await Therapist.findById(req.userId).select("-password");

    if (!therapist) {
      return res.status(404).json({ error: "Therapist not found" });
    }

    res.json({ therapist });
  } catch (error) {
    console.error("Get therapist profile error:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// Update availability
router.put("/availability", auth("therapist"), async (req, res) => {
  try {
    const { isAvailable } = req.body;

    const therapist = await Therapist.findByIdAndUpdate(
      req.userId,
      { isAvailable, updatedAt: new Date() },
      { new: true }
    ).select("-password");

    res.json({ therapist });
  } catch (error) {
    console.error("Update availability error:", error);
    res.status(500).json({ error: "Failed to update availability" });
  }
});

// Get therapist call history
router.get("/call-history", auth("therapist"), async (req, res) => {
  try {
    const calls = await CallLog.find({
      therapistId: req.userId,
      status: {
        $in: ["ended_by_user", "ended_by_therapist", "missed", "rejected"],
      },
    })
      .populate("userId", "phoneNumber")
      .sort({ startTime: -1 })
      .limit(100); // Limit to last 100 calls

    res.json({ calls });
  } catch (error) {
    console.error("Get call history error:", error);
    res.status(500).json({ error: "Failed to fetch call history" });
  }
});

// Get therapist statistics
router.get("/stats", auth("therapist"), async (req, res) => {
  try {
    const therapistId = req.userId;
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    // Today's stats
    const todayStats = await CallLog.aggregate([
      {
        $match: {
          therapistId: new mongoose.Types.ObjectId(therapistId),
          startTime: { $gte: startOfDay, $lte: endOfDay },
          status: { $in: ["ended_by_user", "ended_by_therapist"] },
        },
      },
      {
        $group: {
          _id: null,
          callsToday: { $sum: 1 },
          earningsToday: { $sum: "$therapistEarningsCoins" },
          minutesToday: { $sum: "$durationMinutes" },
        },
      },
    ]);

    const today_data = todayStats[0] || {
      callsToday: 0,
      earningsToday: 0,
      minutesToday: 0,
    };

    // This week's stats
    const weekStats = await CallLog.aggregate([
      {
        $match: {
          therapistId: new mongoose.Types.ObjectId(therapistId),
          startTime: { $gte: startOfWeek },
          status: { $in: ["ended_by_user", "ended_by_therapist"] },
        },
      },
      {
        $group: {
          _id: null,
          callsWeek: { $sum: 1 },
          earningsWeek: { $sum: "$therapistEarningsCoins" },
          minutesWeek: { $sum: "$durationMinutes" },
        },
      },
    ]);

    const week_data = weekStats[0] || {
      callsWeek: 0,
      earningsWeek: 0,
      minutesWeek: 0,
    };

    // All-time stats
    const allTimeStats = await CallLog.aggregate([
      {
        $match: {
          therapistId: new mongoose.Types.ObjectId(therapistId),
          status: { $in: ["ended_by_user", "ended_by_therapist"] },
        },
      },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          totalEarnings: { $sum: "$therapistEarningsCoins" },
          totalMinutes: { $sum: "$durationMinutes" },
          avgDuration: { $avg: "$durationMinutes" },
        },
      },
    ]);

    const allTime_data = allTimeStats[0] || {
      totalCalls: 0,
      totalEarnings: 0,
      totalMinutes: 0,
      avgDuration: 0,
    };

    // Monthly breakdown for the last 6 months
    const sixMonthsAgo = new Date(today);
    sixMonthsAgo.setMonth(today.getMonth() - 6);

    const monthlyStats = await CallLog.aggregate([
      {
        $match: {
          therapistId: new mongoose.Types.ObjectId(therapistId),
          startTime: { $gte: sixMonthsAgo },
          status: { $in: ["ended_by_user", "ended_by_therapist"] },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$startTime" },
            month: { $month: "$startTime" },
          },
          calls: { $sum: 1 },
          earnings: { $sum: "$therapistEarningsCoins" },
          minutes: { $sum: "$durationMinutes" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    res.json({
      today: today_data,
      week: week_data,
      allTime: allTime_data,
      monthly: monthlyStats,
    });
  } catch (error) {
    console.error("Get therapist stats error:", error);
    res.status(500).json({ error: "Failed to fetch therapist statistics" });
  }
});

// Get earnings breakdown
router.get("/earnings", auth("therapist"), async (req, res) => {
  try {
    const therapistId = req.userId;

    // Get detailed earnings breakdown
    const earningsBreakdown = await CallLog.aggregate([
      {
        $match: {
          therapistId: new mongoose.Types.ObjectId(therapistId),
          status: { $in: ["ended_by_user", "ended_by_therapist"] },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$startTime" },
          },
          dailyEarnings: { $sum: "$therapistEarningsCoins" },
          dailyCalls: { $sum: 1 },
          dailyMinutes: { $sum: "$durationMinutes" },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 30 }, // Last 30 days
    ]);

    // Calculate pending withdrawals (if you implement withdrawal system)
    const pendingWithdrawals = 0; // Placeholder for future implementation

    res.json({
      dailyBreakdown: earningsBreakdown,
      pendingWithdrawals,
      totalAvailable: (await Therapist.findById(therapistId))
        .totalEarningsCoins,
    });
  } catch (error) {
    console.error("Get earnings error:", error);
    res.status(500).json({ error: "Failed to fetch earnings data" });
  }
});

// Get performance metrics
router.get("/performance", auth("therapist"), async (req, res) => {
  try {
    const therapistId = req.userId;

    // Calculate acceptance rate (answered vs total calls)
    const callCounts = await CallLog.aggregate([
      { $match: { therapistId: new mongoose.Types.ObjectId(therapistId) } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const totalCalls = callCounts.reduce((sum, item) => sum + item.count, 0);
    const answeredCalls =
      callCounts.find((item) =>
        ["ended_by_user", "ended_by_therapist"].includes(item._id)
      )?.count || 0;

    const acceptanceRate =
      totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;

    // Average session length
    const avgSessionResult = await CallLog.aggregate([
      {
        $match: {
          therapistId: new mongoose.Types.ObjectId(therapistId),
          status: { $in: ["ended_by_user", "ended_by_therapist"] },
        },
      },
      {
        $group: {
          _id: null,
          avgDuration: { $avg: "$durationMinutes" },
        },
      },
    ]);

    const avgSessionLength = Math.round(avgSessionResult[0]?.avgDuration || 0);

    // Rating (placeholder - implement when you add rating system)
    const averageRating = 4.5; // Placeholder

    // Response time (placeholder - implement when you track this)
    const avgResponseTime = "< 30 seconds"; // Placeholder

    res.json({
      acceptanceRate,
      avgSessionLength,
      averageRating,
      avgResponseTime,
      totalSessions: answeredCalls,
      callBreakdown: callCounts,
    });
  } catch (error) {
    console.error("Get performance error:", error);
    res.status(500).json({ error: "Failed to fetch performance metrics" });
  }
});

module.exports = router;

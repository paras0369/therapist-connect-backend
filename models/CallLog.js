// Enhanced models/CallLog.js - WebRTC support
const mongoose = require("mongoose");

const callLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    therapistId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Therapist",
      required: true,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      default: null,
    },
    actualStartTime: {
      type: Date,
      default: null, // When the call was actually answered
    },
    actualDuration: {
      type: Number,
      default: 0, // Duration in seconds
    },
    durationMinutes: {
      type: Number,
      default: 0, // Duration in minutes for billing
    },
    costInCoins: {
      type: Number,
      default: 0,
    },
    therapistEarningsCoins: {
      type: Number,
      default: 0,
    },
    estimatedCost: {
      type: Number,
      default: 0, // Estimated cost per minute when call was initiated
    },
    status: {
      type: String,
      enum: [
        "initiated",
        "answered",
        "ended_by_user",
        "ended_by_therapist",
        "rejected",
        "missed",
        "cancelled_by_user",
        "cancelled_by_therapist",
        "busy",
        "offline",
      ],
      default: "initiated",
    },
    // WebRTC specific fields
    callId: {
      type: String,
      required: true,
      unique: true, // Ensure unique call IDs
      index: true,
    },
    callType: {
      type: String,
      enum: ["voice", "video"],
      default: "voice",
      required: true,
    },
    // Call quality and technical data
    callQuality: {
      networkQuality: {
        type: String,
        enum: ["excellent", "good", "fair", "poor", "unknown"],
        default: "unknown",
      },
      audioQuality: {
        type: Number,
        min: 0,
        max: 5,
        default: 0,
      },
      videoQuality: {
        type: Number,
        min: 0,
        max: 5,
        default: 0,
      },
      connectionTime: {
        type: Number,
        default: 0, // Time to establish connection in milliseconds
      },
      disconnectionCount: {
        type: Number,
        default: 0, // Number of disconnections during call
      },
    },
    // End reasons and additional metadata
    endReason: {
      type: String,
      enum: [
        "ended",
        "timeout",
        "rejected",
        "cancelled",
        "network_error",
        "unknown",
      ],
      default: "unknown",
    },
    rejectReason: {
      type: String,
      default: null,
    },
    // Device and platform information
    deviceInfo: {
      userPlatform: {
        type: String,
        enum: ["android", "ios", "web", "unknown"],
        default: "unknown",
      },
      therapistPlatform: {
        type: String,
        enum: ["android", "ios", "web", "unknown"],
        default: "unknown",
      },
      userAppVersion: {
        type: String,
        default: null,
      },
      therapistAppVersion: {
        type: String,
        default: null,
      },
    },
    // Billing and financial data
    billing: {
      wasCharged: {
        type: Boolean,
        default: false,
      },
      chargeProcessedAt: {
        type: Date,
        default: null,
      },
      refundAmount: {
        type: Number,
        default: 0,
      },
      refundReason: {
        type: String,
        default: null,
      },
      refundProcessedAt: {
        type: Date,
        default: null,
      },
    },
    // User feedback and ratings
    feedback: {
      userRating: {
        type: Number,
        min: 1,
        max: 5,
        default: null,
      },
      therapistRating: {
        type: Number,
        min: 1,
        max: 5,
        default: null,
      },
      userComment: {
        type: String,
        default: null,
        maxlength: 500,
      },
      therapistComment: {
        type: String,
        default: null,
        maxlength: 500,
      },
      technicalIssues: [
        {
          type: String,
          enum: [
            "audio_issues",
            "video_issues",
            "connection_issues",
            "app_crash",
            "poor_quality",
            "lag",
            "echo",
            "other",
          ],
        },
      ],
    },
    // Analytics and tracking
    analytics: {
      connectionAttempts: {
        type: Number,
        default: 1,
      },
      averageLatency: {
        type: Number,
        default: 0, // Average latency in milliseconds
      },
      dataUsage: {
        type: Number,
        default: 0, // Data usage in MB
      },
      batteryImpact: {
        type: Number,
        default: 0, // Battery usage percentage
      },
    },
    // Timestamps
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true, // Automatically manage createdAt and updatedAt
  }
);

// Indexes for better query performance
callLogSchema.index({ userId: 1, createdAt: -1 });
callLogSchema.index({ therapistId: 1, createdAt: -1 });
callLogSchema.index({ status: 1, createdAt: -1 });
callLogSchema.index({ callType: 1, createdAt: -1 });
callLogSchema.index({ startTime: -1 });
callLogSchema.index({ endTime: -1 });

// Compound indexes for complex queries
callLogSchema.index({ userId: 1, status: 1, createdAt: -1 });
callLogSchema.index({ therapistId: 1, status: 1, createdAt: -1 });
callLogSchema.index({ callType: 1, status: 1, createdAt: -1 });

// Virtual properties
callLogSchema.virtual("totalDurationSeconds").get(function () {
  return this.actualDuration || 0;
});

callLogSchema.virtual("isCompleted").get(function () {
  return ["ended_by_user", "ended_by_therapist"].includes(this.status);
});

callLogSchema.virtual("wasSuccessful").get(function () {
  return this.isCompleted && this.durationMinutes > 0;
});

callLogSchema.virtual("callTypeDisplay").get(function () {
  return this.callType === "video" ? "Video Call" : "Voice Call";
});

callLogSchema.virtual("statusDisplay").get(function () {
  const statusMap = {
    initiated: "Calling...",
    answered: "In Progress",
    ended_by_user: "Completed",
    ended_by_therapist: "Completed",
    rejected: "Rejected",
    missed: "Missed",
    cancelled_by_user: "Cancelled",
    cancelled_by_therapist: "Cancelled",
    busy: "Busy",
    offline: "Offline",
  };
  return statusMap[this.status] || "Unknown";
});

// Instance methods
callLogSchema.methods.calculateCost = function (durationSeconds, callType) {
  const CALL_PRICING = {
    voice: { costPerMinute: 5, therapistEarningsPerMinute: 2.5 },
    video: { costPerMinute: 8, therapistEarningsPerMinute: 4 },
  };

  const pricing = CALL_PRICING[callType] || CALL_PRICING.voice;
  const durationMinutes = Math.max(1, Math.ceil(durationSeconds / 60));

  return {
    durationMinutes,
    costInCoins: durationMinutes * pricing.costPerMinute,
    therapistEarningsCoins: Math.floor(
      durationMinutes * pricing.therapistEarningsPerMinute
    ),
  };
};

callLogSchema.methods.updateCallQuality = function (qualityData) {
  this.callQuality = {
    ...this.callQuality,
    ...qualityData,
  };
  return this.save();
};

callLogSchema.methods.addFeedback = function (
  userType,
  rating,
  comment,
  technicalIssues = []
) {
  if (userType === "user") {
    this.feedback.userRating = rating;
    this.feedback.userComment = comment;
  } else if (userType === "therapist") {
    this.feedback.therapistRating = rating;
    this.feedback.therapistComment = comment;
  }

  if (technicalIssues.length > 0) {
    this.feedback.technicalIssues = [
      ...new Set([...this.feedback.technicalIssues, ...technicalIssues]),
    ];
  }

  return this.save();
};

callLogSchema.methods.processRefund = function (amount, reason) {
  this.billing.refundAmount = amount;
  this.billing.refundReason = reason;
  this.billing.refundProcessedAt = new Date();
  return this.save();
};

// Static methods
callLogSchema.statics.findByCallId = function (callId) {
  return this.findOne({ callId });
};

callLogSchema.statics.getActiveCallsCount = function (userId, userType) {
  const query = {
    status: { $in: ["initiated", "answered"] },
  };

  if (userType === "user") {
    query.userId = userId;
  } else if (userType === "therapist") {
    query.therapistId = userId;
  }

  return this.countDocuments(query);
};

callLogSchema.statics.getUserStats = function (userId, timeframe = "all") {
  let dateFilter = {};

  if (timeframe === "today") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    dateFilter = { createdAt: { $gte: today } };
  } else if (timeframe === "week") {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    dateFilter = { createdAt: { $gte: weekAgo } };
  } else if (timeframe === "month") {
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    dateFilter = { createdAt: { $gte: monthAgo } };
  }

  return this.aggregate([
    {
      $match: {
        userId: userId,
        status: { $in: ["ended_by_user", "ended_by_therapist"] },
        ...dateFilter,
      },
    },
    {
      $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        totalMinutes: { $sum: "$durationMinutes" },
        totalCost: { $sum: "$costInCoins" },
        voiceCalls: {
          $sum: { $cond: [{ $eq: ["$callType", "voice"] }, 1, 0] },
        },
        videoCalls: {
          $sum: { $cond: [{ $eq: ["$callType", "video"] }, 1, 0] },
        },
        avgDuration: { $avg: "$durationMinutes" },
        avgRating: { $avg: "$feedback.therapistRating" },
      },
    },
  ]);
};

callLogSchema.statics.getTherapistStats = function (
  therapistId,
  timeframe = "all"
) {
  let dateFilter = {};

  if (timeframe === "today") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    dateFilter = { createdAt: { $gte: today } };
  } else if (timeframe === "week") {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    dateFilter = { createdAt: { $gte: weekAgo } };
  } else if (timeframe === "month") {
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    dateFilter = { createdAt: { $gte: monthAgo } };
  }

  return this.aggregate([
    {
      $match: {
        therapistId: therapistId,
        status: { $in: ["ended_by_user", "ended_by_therapist"] },
        ...dateFilter,
      },
    },
    {
      $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        totalMinutes: { $sum: "$durationMinutes" },
        totalEarnings: { $sum: "$therapistEarningsCoins" },
        voiceCalls: {
          $sum: { $cond: [{ $eq: ["$callType", "voice"] }, 1, 0] },
        },
        videoCalls: {
          $sum: { $cond: [{ $eq: ["$callType", "video"] }, 1, 0] },
        },
        avgDuration: { $avg: "$durationMinutes" },
        avgRating: { $avg: "$feedback.userRating" },
      },
    },
  ]);
};

callLogSchema.statics.getCallQualityStats = function (timeframe = "week") {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  return this.aggregate([
    {
      $match: {
        createdAt: { $gte: weekAgo },
        status: { $in: ["ended_by_user", "ended_by_therapist"] },
      },
    },
    {
      $group: {
        _id: "$callQuality.networkQuality",
        count: { $sum: 1 },
        avgAudioQuality: { $avg: "$callQuality.audioQuality" },
        avgVideoQuality: { $avg: "$callQuality.videoQuality" },
        avgConnectionTime: { $avg: "$callQuality.connectionTime" },
      },
    },
  ]);
};

// Pre-save middleware to update timestamps
callLogSchema.pre("save", function (next) {
  if (this.isNew) {
    this.createdAt = new Date();
  }
  this.updatedAt = new Date();
  next();
});

// Pre-save middleware to validate call data
callLogSchema.pre("save", function (next) {
  // Ensure callId is provided for new calls
  if (this.isNew && !this.callId) {
    return next(new Error("Call ID is required"));
  }

  // Validate call type
  if (!["voice", "video"].includes(this.callType)) {
    return next(new Error("Invalid call type"));
  }

  // Ensure end time is after start time
  if (this.endTime && this.startTime && this.endTime < this.startTime) {
    return next(new Error("End time cannot be before start time"));
  }

  // Calculate duration if not provided
  if (this.endTime && this.startTime && !this.actualDuration) {
    this.actualDuration = Math.floor((this.endTime - this.startTime) / 1000);
  }

  next();
});

// Post-save middleware for analytics
callLogSchema.post("save", function (doc) {
  // Log call completion for analytics
  if (doc.status.includes("ended") && doc.durationMinutes > 0) {
    console.log(
      `Call completed: ${doc.callId}, Duration: ${doc.durationMinutes} min, Type: ${doc.callType}`
    );
  }
});

// Export the model
module.exports = mongoose.model("CallLog", callLogSchema);

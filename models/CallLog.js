// models/CallLog.js
const mongoose = require("mongoose");

const callLogSchema = new mongoose.Schema({
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
  durationMinutes: {
    type: Number,
    default: 0,
  },
  costInCoins: {
    type: Number,
    default: 0,
  },
  therapistEarningsCoins: {
    type: Number,
    default: 0,
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
    ],
    default: "initiated",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("CallLog", callLogSchema);

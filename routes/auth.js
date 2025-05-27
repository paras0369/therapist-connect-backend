// Fixed routes/auth.js - Fix the FCM token update route
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const twilio = require("twilio");
const User = require("../models/User");
const Therapist = require("../models/Therapist");

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Generate JWT token
const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET || "your-secret-key", {
    expiresIn: "30d",
  });
};

// Update FCM token for user - FIXED VERSION
router.post("/update-fcm-token", async (req, res) => {
  try {
    const { userId, fcmToken, userType } = req.body;

    // Skip if userId is "temp" or invalid
    if (!userId || userId === "temp" || !fcmToken) {
      console.log(
        "Skipping FCM token update - invalid userId or missing token"
      );
      return res.json({ success: true, message: "FCM token update skipped" });
    }

    if (userType === "user") {
      await User.findByIdAndUpdate(userId, { fcmToken });
      console.log(`FCM token updated for user ${userId}`);
    } else if (userType === "therapist") {
      await Therapist.findByIdAndUpdate(userId, { fcmToken });
      console.log(`FCM token updated for therapist ${userId}`);
    }

    res.json({ success: true, message: "FCM token updated successfully" });
  } catch (error) {
    console.error("Update FCM token error:", error);
    res.status(500).json({ error: "Failed to update FCM token" });
  }
});

// Send OTP to user
router.post("/send-otp", async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Find or create user
    let user = await User.findOne({ phoneNumber });
    if (!user) {
      user = new User({ phoneNumber });
    }

    user.otp = otp;
    user.otpExpiry = otpExpiry;
    await user.save();

    // Send OTP via Twilio
    if (process.env.NODE_ENV === "production") {
      await twilioClient.messages.create({
        body: `Your Therapist Connect OTP is: ${otp}`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phoneNumber,
      });
    } else {
      console.log(`OTP for ${phoneNumber}: ${otp}`);
    }

    res.json({ success: true, message: "OTP sent successfully" });
  } catch (error) {
    console.error("Send OTP error:", error);
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

// Verify OTP and login - FIXED VERSION
router.post("/verify-otp", async (req, res) => {
  try {
    const { phoneNumber, otp, fcmToken } = req.body;

    const user = await User.findOne({ phoneNumber });
    if (!user || !user.otp || !user.otpExpiry) {
      return res.status(400).json({ error: "Invalid OTP request" });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    if (new Date() > user.otpExpiry) {
      return res.status(400).json({ error: "OTP expired" });
    }

    // Clear OTP and update FCM token if provided
    user.otp = null;
    user.otpExpiry = null;
    if (fcmToken) {
      user.fcmToken = fcmToken;
    }
    await user.save();

    const token = generateToken(user._id, "user");

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        coinBalance: user.coinBalance,
      },
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({ error: "Failed to verify OTP" });
  }
});

// Therapist login - FIXED VERSION
router.post("/therapist-login", async (req, res) => {
  try {
    const { email, password, fcmToken } = req.body;

    const therapist = await Therapist.findOne({ email });
    if (!therapist) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isValidPassword = await therapist.comparePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Update FCM token if provided
    if (fcmToken) {
      therapist.fcmToken = fcmToken;
      await therapist.save();
    }

    const token = generateToken(therapist._id, "therapist");

    res.json({
      success: true,
      token,
      therapist: {
        id: therapist._id,
        name: therapist.name,
        email: therapist.email,
        isAvailable: therapist.isAvailable,
        totalEarningsCoins: therapist.totalEarningsCoins,
      },
    });
  } catch (error) {
    console.error("Therapist login error:", error);
    res.status(500).json({ error: "Failed to login" });
  }
});

module.exports = router;

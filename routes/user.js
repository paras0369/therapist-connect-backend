// routes/user.js
const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Therapist = require("../models/Therapist");
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

// Get user profile
router.get("/profile", auth("user"), async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-otp -otpExpiry");

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

module.exports = router;

// routes/therapist.js
const express = require("express");
const router = express.Router();
const Therapist = require("../models/Therapist");
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

module.exports = router;

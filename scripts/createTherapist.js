const mongoose = require("mongoose");
const Therapist = require("../models/Therapist");
require("dotenv").config();

// how to use - Run with: node scripts/createTherapist.js

async function createTherapist() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const therapist = new Therapist({
      name: "Dr. John Doe",
      email: "A@1.com",
      password: "123", // Will be hashed automatically
    });

    await therapist.save();
    console.log("Therapist created successfully");
    process.exit(0);
  } catch (error) {
    console.error("Error creating therapist:", error);
    process.exit(1);
  }
}

createTherapist();

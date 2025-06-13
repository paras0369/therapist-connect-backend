#!/usr/bin/env node

const mongoose = require('mongoose');
const CallLog = require('../models/CallLog');

// Database connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/therapyconnect';

async function cleanupStuckCalls() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find all stuck calls (initiated or answered status)
    const stuckCalls = await CallLog.find({
      status: { $in: ['initiated', 'answered'] }
    });

    console.log(`Found ${stuckCalls.length} stuck calls:`);
    
    stuckCalls.forEach((call, index) => {
      console.log(`${index + 1}. Call ID: ${call._id}`);
      console.log(`   User ID: ${call.userId}`);
      console.log(`   Therapist ID: ${call.therapistId}`);
      console.log(`   Status: ${call.status}`);
      console.log(`   Created: ${call.createdAt}`);
      console.log(`   Call ID: ${call.callId}`);
      console.log('');
    });

    if (stuckCalls.length === 0) {
      console.log('No stuck calls found. Exiting...');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Ask for confirmation
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(`Do you want to clean up all ${stuckCalls.length} stuck calls? (y/N): `, async (answer) => {
      if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
        // Update all stuck calls to cancelled
        const result = await CallLog.updateMany(
          { status: { $in: ['initiated', 'answered'] } },
          {
            status: 'cancelled_by_user',
            endTime: new Date(),
            endReason: 'cleanup_script'
          }
        );

        console.log(`Successfully cleaned up ${result.modifiedCount} calls`);
      } else {
        console.log('Cleanup cancelled');
      }

      rl.close();
      await mongoose.disconnect();
      console.log('Disconnected from MongoDB');
      process.exit(0);
    });

  } catch (error) {
    console.error('Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the cleanup
cleanupStuckCalls();
// services/firebaseAdmin.js - FIXED VERSION - Use Single Firebase Project
const admin = require("firebase-admin");

// Use ONLY ONE Firebase project for both users and therapists
let firebaseApp = null;

try {
  // Use the same Firebase project for both users and therapists
  // Choose one of your service account files (recommend keeping therapistconnect-76dd0)
  const serviceAccount = require("../config/therapistconnect-76dd0-firebase-adminsdk-fbsvc-b165ccebe0.json");

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log("Firebase app initialized successfully");
} catch (error) {
  console.error("Failed to initialize Firebase app:", error);
}

class FirebaseNotificationService {
  // Send notification to therapist
  static async sendCallNotification(therapistFCMToken, callData) {
    try {
      if (!firebaseApp) {
        console.error("Firebase app not initialized");
        return null;
      }

      const message = {
        token: therapistFCMToken,
        notification: {
          title: "📞 Incoming Call",
          body: `${callData.userName || "A user"} is calling you`,
        },
        data: {
          type: "incoming_call",
          userId: callData.userId,
          userName: callData.userName || "User",
          roomId: callData.roomId,
          callId: callData.callId || "",
          zegoCallId: callData.zegoCallId || "", // Make sure this is included
          callType: callData.callType || "voice",
          therapistId: callData.therapistId || "",
          timestamp: Date.now().toString(),
        },
        android: {
          priority: "high",
          notification: {
            channelId: "call_notifications",
            priority: "high",
            defaultSound: true,
            defaultVibrateTimings: true,
            visibility: "public",
            sound: "default",
            tag: "incoming_call",
          },
          ttl: 30000, // 30 seconds TTL for call notifications
        },
      };

      const response = await firebaseApp.messaging().send(message);
      console.log(
        "Successfully sent call notification to therapist:",
        response
      );
      return response;
    } catch (error) {
      console.error("Error sending call notification to therapist:", error);
      throw error;
    }
  }

  // Send notification to user
  static async sendCallEndedNotification(userFCMToken, callData) {
    try {
      if (!firebaseApp) {
        console.error("Firebase app not initialized");
        return null;
      }

      const message = {
        token: userFCMToken,
        notification: {
          title: "Call Ended",
          body: `Your session with the therapist has ended`,
        },
        data: {
          type: "call_ended",
          callId: callData.callId || "",
          duration: callData.duration || "0",
          cost: callData.cost || "0",
          callType: callData.callType || "voice",
        },
        android: {
          notification: {
            channelId: "general_notifications",
            sound: "default",
          },
        },
      };

      const response = await firebaseApp.messaging().send(message);
      console.log(
        "Successfully sent call ended notification to user:",
        response
      );
      return response;
    } catch (error) {
      console.error("Error sending call ended notification to user:", error);
      throw error;
    }
  }

  // Send notification to user about general updates
  static async sendUserNotification(userFCMToken, notificationData) {
    try {
      if (!firebaseApp) {
        console.error("Firebase app not initialized");
        return null;
      }

      const message = {
        token: userFCMToken,
        notification: {
          title: notificationData.title,
          body: notificationData.body,
        },
        data: notificationData.data || {},
        android: {
          notification: {
            channelId: "general_notifications",
            sound: "default",
          },
        },
      };

      const response = await firebaseApp.messaging().send(message);
      console.log("Successfully sent user notification:", response);
      return response;
    } catch (error) {
      console.error("Error sending user notification:", error);
      throw error;
    }
  }

  // Send notification to therapist about general updates
  static async sendTherapistNotification(therapistFCMToken, notificationData) {
    try {
      if (!firebaseApp) {
        console.error("Firebase app not initialized");
        return null;
      }

      const message = {
        token: therapistFCMToken,
        notification: {
          title: notificationData.title,
          body: notificationData.body,
        },
        data: notificationData.data || {},
        android: {
          notification: {
            channelId: "general_notifications",
            sound: "default",
          },
        },
      };

      const response = await firebaseApp.messaging().send(message);
      console.log("Successfully sent therapist notification:", response);
      return response;
    } catch (error) {
      console.error("Error sending therapist notification:", error);
      throw error;
    }
  }

  // Topic messaging
  static async sendToTopic(topic, title, body, data = {}) {
    try {
      if (!firebaseApp) {
        console.error("Firebase app not initialized");
        return null;
      }

      const message = {
        topic: topic,
        notification: {
          title: title,
          body: body,
        },
        data: data,
        android: {
          notification: {
            channelId: "general_notifications",
            sound: "default",
          },
        },
      };

      const response = await firebaseApp.messaging().send(message);
      console.log("Successfully sent topic notification:", response);
      return response;
    } catch (error) {
      console.error("Error sending topic notification:", error);
      throw error;
    }
  }

  // Subscribe to topic
  static async subscribeToTopic(tokens, topic) {
    try {
      if (!firebaseApp) {
        console.error("Firebase app not initialized");
        return null;
      }

      const response = await firebaseApp
        .messaging()
        .subscribeToTopic(tokens, topic);
      console.log("Successfully subscribed to topic:", response);
      return response;
    } catch (error) {
      console.error("Error subscribing to topic:", error);
      throw error;
    }
  }

  // Unsubscribe from topic
  static async unsubscribeFromTopic(tokens, topic) {
    try {
      if (!firebaseApp) {
        console.error("Firebase app not initialized");
        return null;
      }

      const response = await firebaseApp
        .messaging()
        .unsubscribeFromTopic(tokens, topic);
      console.log("Successfully unsubscribed from topic:", response);
      return response;
    } catch (error) {
      console.error("Error unsubscribing from topic:", error);
      throw error;
    }
  }

  // Utility method to check if app is ready
  static isReady() {
    return firebaseApp !== null;
  }

  // Validate FCM token format
  static isValidToken(token) {
    if (!token || typeof token !== "string") {
      return false;
    }

    // FCM tokens are typically 163+ characters long
    if (token.length < 100) {
      return false;
    }

    // Basic format check - FCM tokens are alphanumeric with some special chars
    const tokenRegex = /^[A-Za-z0-9_:/-]+$/;
    return tokenRegex.test(token);
  }

  // Test notification - useful for debugging
  static async sendTestNotification(fcmToken, userType = "user") {
    try {
      const message = {
        token: fcmToken,
        notification: {
          title: "🧪 Test Notification",
          body: `Test notification for ${userType}`,
        },
        data: {
          type: "test",
          timestamp: Date.now().toString(),
        },
      };

      const response = await firebaseApp.messaging().send(message);
      console.log(
        `Test notification sent successfully to ${userType}:`,
        response
      );
      return response;
    } catch (error) {
      console.error(`Error sending test notification to ${userType}:`, error);
      throw error;
    }
  }
}

module.exports = FirebaseNotificationService;

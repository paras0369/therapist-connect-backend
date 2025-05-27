// Fixed services/firebaseAdmin.js - Correct Android notification payload
const admin = require("firebase-admin");

// Initialize Firebase Admin SDK
const serviceAccount = require("../config/therapistconnect-76dd0-firebase-adminsdk-fbsvc-a48d512c99.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

class FirebaseNotificationService {
  static async sendCallNotification(therapistFCMToken, callData) {
    try {
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
          timestamp: Date.now().toString(),
        },
        android: {
          priority: "high",
          notification: {
            channelId: "call_notifications",
            priority: "high",
            defaultSound: true,
            defaultVibrateTimings: true,
            // REMOVED: importance - this is not a valid field here
            visibility: "public",
            sound: "default",
            tag: "incoming_call",
          },
          ttl: 30000, // 30 seconds TTL for call notifications
        },
      };

      const response = await admin.messaging().send(message);
      console.log("Successfully sent call notification:", response);
      return response;
    } catch (error) {
      console.error("Error sending call notification:", error);
      throw error;
    }
  }

  static async sendCallEndedNotification(userFCMToken, callData) {
    try {
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
        },
        android: {
          notification: {
            channelId: "general_notifications",
            sound: "default",
          },
        },
      };

      const response = await admin.messaging().send(message);
      console.log("Successfully sent call ended notification:", response);
      return response;
    } catch (error) {
      console.error("Error sending call ended notification:", error);
      throw error;
    }
  }

  static async sendToTopic(topic, title, body, data = {}) {
    try {
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

      const response = await admin.messaging().send(message);
      console.log("Successfully sent topic notification:", response);
      return response;
    } catch (error) {
      console.error("Error sending topic notification:", error);
      throw error;
    }
  }

  static async subscribeToTopic(tokens, topic) {
    try {
      const response = await admin.messaging().subscribeToTopic(tokens, topic);
      console.log("Successfully subscribed to topic:", response);
      return response;
    } catch (error) {
      console.error("Error subscribing to topic:", error);
      throw error;
    }
  }

  static async unsubscribeFromTopic(tokens, topic) {
    try {
      const response = await admin
        .messaging()
        .unsubscribeFromTopic(tokens, topic);
      console.log("Successfully unsubscribed from topic:", response);
      return response;
    } catch (error) {
      console.error("Error unsubscribing from topic:", error);
      throw error;
    }
  }
}

module.exports = FirebaseNotificationService;

// services/firebaseAdmin.js - Updated for multiple Firebase projects
const admin = require("firebase-admin");

// Initialize separate Firebase Admin apps for user and therapist
let userApp = null;
let therapistApp = null;

try {
  // User app Firebase configuration
  const userServiceAccount = require("../config/therapistconnect-76dd0-firebase-adminsdk-fbsvc-a48d512c99.json"); // You'll need this file
  userApp = admin.initializeApp(
    {
      credential: admin.credential.cert(userServiceAccount),
    },
    "userApp"
  );
  console.log("User Firebase app initialized successfully");
} catch (error) {
  console.error("Failed to initialize user Firebase app:", error);
}

try {
  // Therapist app Firebase configuration
  const therapistServiceAccount = require("../config/therapistconnect-76dd0-firebase-adminsdk-fbsvc-a48d512c99.json");
  therapistApp = admin.initializeApp(
    {
      credential: admin.credential.cert(therapistServiceAccount),
    },
    "therapistApp"
  );
  console.log("Therapist Firebase app initialized successfully");
} catch (error) {
  console.error("Failed to initialize therapist Firebase app:", error);
}

class FirebaseNotificationService {
  // Send notification to therapist (using therapist Firebase project)
  static async sendCallNotification(therapistFCMToken, callData) {
    try {
      if (!therapistApp) {
        console.error("Therapist Firebase app not initialized");
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

      const response = await therapistApp.messaging().send(message);
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

  // Send notification to user (using user Firebase project)
  static async sendCallEndedNotification(userFCMToken, callData) {
    try {
      if (!userApp) {
        console.error("User Firebase app not initialized");
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
        },
        android: {
          notification: {
            channelId: "general_notifications",
            sound: "default",
          },
        },
      };

      const response = await userApp.messaging().send(message);
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

  // Send notification to user about therapist availability, etc.
  static async sendUserNotification(userFCMToken, notificationData) {
    try {
      if (!userApp) {
        console.error("User Firebase app not initialized");
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

      const response = await userApp.messaging().send(message);
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
      if (!therapistApp) {
        console.error("Therapist Firebase app not initialized");
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

      const response = await therapistApp.messaging().send(message);
      console.log("Successfully sent therapist notification:", response);
      return response;
    } catch (error) {
      console.error("Error sending therapist notification:", error);
      throw error;
    }
  }

  // Topic messaging for users
  static async sendToUserTopic(topic, title, body, data = {}) {
    try {
      if (!userApp) {
        console.error("User Firebase app not initialized");
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

      const response = await userApp.messaging().send(message);
      console.log("Successfully sent user topic notification:", response);
      return response;
    } catch (error) {
      console.error("Error sending user topic notification:", error);
      throw error;
    }
  }

  // Topic messaging for therapists
  static async sendToTherapistTopic(topic, title, body, data = {}) {
    try {
      if (!therapistApp) {
        console.error("Therapist Firebase app not initialized");
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

      const response = await therapistApp.messaging().send(message);
      console.log("Successfully sent therapist topic notification:", response);
      return response;
    } catch (error) {
      console.error("Error sending therapist topic notification:", error);
      throw error;
    }
  }

  // Subscribe user to topic
  static async subscribeUserToTopic(tokens, topic) {
    try {
      if (!userApp) {
        console.error("User Firebase app not initialized");
        return null;
      }

      const response = await userApp
        .messaging()
        .subscribeToTopic(tokens, topic);
      console.log("Successfully subscribed users to topic:", response);
      return response;
    } catch (error) {
      console.error("Error subscribing users to topic:", error);
      throw error;
    }
  }

  // Subscribe therapist to topic
  static async subscribeTherapistToTopic(tokens, topic) {
    try {
      if (!therapistApp) {
        console.error("Therapist Firebase app not initialized");
        return null;
      }

      const response = await therapistApp
        .messaging()
        .subscribeToTopic(tokens, topic);
      console.log("Successfully subscribed therapists to topic:", response);
      return response;
    } catch (error) {
      console.error("Error subscribing therapists to topic:", error);
      throw error;
    }
  }

  // Unsubscribe user from topic
  static async unsubscribeUserFromTopic(tokens, topic) {
    try {
      if (!userApp) {
        console.error("User Firebase app not initialized");
        return null;
      }

      const response = await userApp
        .messaging()
        .unsubscribeFromTopic(tokens, topic);
      console.log("Successfully unsubscribed users from topic:", response);
      return response;
    } catch (error) {
      console.error("Error unsubscribing users from topic:", error);
      throw error;
    }
  }

  // Unsubscribe therapist from topic
  static async unsubscribeTherapistFromTopic(tokens, topic) {
    try {
      if (!therapistApp) {
        console.error("Therapist Firebase app not initialized");
        return null;
      }

      const response = await therapistApp
        .messaging()
        .unsubscribeFromTopic(tokens, topic);
      console.log("Successfully unsubscribed therapists from topic:", response);
      return response;
    } catch (error) {
      console.error("Error unsubscribing therapists from topic:", error);
      throw error;
    }
  }

  // Utility method to check if apps are initialized
  static isUserAppReady() {
    return userApp !== null;
  }

  static isTherapistAppReady() {
    return therapistApp !== null;
  }
}

module.exports = FirebaseNotificationService;

// services/signalingServer.js - WebRTC Signaling Server
const { Server } = require('socket.io');

class SignalingServer {
  constructor(httpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });
    
    this.connectedUsers = new Map(); // userID -> socketID
    this.userSockets = new Map(); // socketID -> userInfo
    this.activeCalls = new Map(); // callID -> callInfo
    
    this.setupEventHandlers();
  }
  
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`Socket connected: ${socket.id}`);
      
      // User registration
      socket.on('register', (userInfo) => {
        const { userID, userType, userName } = userInfo;
        
        this.connectedUsers.set(userID, socket.id);
        this.userSockets.set(socket.id, { userID, userType, userName });
        
        console.log(`User registered: ${userID} (${userType}) - ${userName}`);
        
        // Notify user of successful registration
        socket.emit('registered', { userID, status: 'online' });
        
        // Notify others about user online status
        socket.broadcast.emit('user-status-changed', { 
          userID, 
          status: 'online', 
          userType 
        });
      });
      
      // Call initiation
      socket.on('initiate-call', async (data) => {
        const { callerID, calleeID, callType, callID } = data;
        const calleeSocketID = this.connectedUsers.get(calleeID);
        
        console.log(`Call initiated: ${callerID} -> ${calleeID} (${callType})`);
        
        if (!calleeSocketID) {
          socket.emit('call-error', { 
            error: 'User not available',
            callID 
          });
          return;
        }
        
        // Store call information
        this.activeCalls.set(callID, {
          callerID,
          calleeID,
          callType,
          status: 'ringing',
          startTime: Date.now()
        });
        
        // Send call invitation to callee
        this.io.to(calleeSocketID).emit('incoming-call', {
          callerID,
          calleeID,
          callType,
          callID,
          callerName: this.userSockets.get(socket.id)?.userName || 'Unknown'
        });
        
        // Confirm call initiated to caller
        socket.emit('call-initiated', { callID, status: 'ringing' });
      });
      
      // Call acceptance
      socket.on('accept-call', (data) => {
        const { callID } = data;
        const call = this.activeCalls.get(callID);
        
        if (!call) {
          socket.emit('call-error', { error: 'Call not found', callID });
          return;
        }
        
        const callerSocketID = this.connectedUsers.get(call.callerID);
        
        if (callerSocketID) {
          // Update call status
          call.status = 'connecting';
          this.activeCalls.set(callID, call);
          
          // Notify caller that call was accepted
          this.io.to(callerSocketID).emit('call-accepted', { callID });
          
          console.log(`Call accepted: ${call.callerID} <-> ${call.calleeID}`);
        }
      });
      
      // Call rejection
      socket.on('reject-call', (data) => {
        const { callID, reason } = data;
        const call = this.activeCalls.get(callID);
        
        if (!call) return;
        
        const callerSocketID = this.connectedUsers.get(call.callerID);
        
        if (callerSocketID) {
          this.io.to(callerSocketID).emit('call-rejected', { 
            callID, 
            reason: reason || 'Call declined' 
          });
        }
        
        // Remove call from active calls
        this.activeCalls.delete(callID);
        
        console.log(`Call rejected: ${call.callerID} -> ${call.calleeID}`);
      });
      
      // WebRTC signaling events
      socket.on('webrtc-offer', (data) => {
        const { callID, offer, targetUserID } = data;
        const targetSocketID = this.connectedUsers.get(targetUserID);
        
        if (targetSocketID) {
          this.io.to(targetSocketID).emit('webrtc-offer', {
            callID,
            offer,
            senderID: this.userSockets.get(socket.id)?.userID
          });
        }
      });
      
      socket.on('webrtc-answer', (data) => {
        const { callID, answer, targetUserID } = data;
        const targetSocketID = this.connectedUsers.get(targetUserID);
        
        if (targetSocketID) {
          this.io.to(targetSocketID).emit('webrtc-answer', {
            callID,
            answer,
            senderID: this.userSockets.get(socket.id)?.userID
          });
        }
      });
      
      socket.on('webrtc-ice-candidate', (data) => {
        const { callID, candidate, targetUserID } = data;
        const targetSocketID = this.connectedUsers.get(targetUserID);
        
        if (targetSocketID) {
          this.io.to(targetSocketID).emit('webrtc-ice-candidate', {
            callID,
            candidate,
            senderID: this.userSockets.get(socket.id)?.userID
          });
        }
      });
      
      // Call termination
      socket.on('end-call', (data) => {
        const { callID } = data;
        const call = this.activeCalls.get(callID);
        
        if (call) {
          const otherUserID = call.callerID === this.userSockets.get(socket.id)?.userID 
            ? call.calleeID 
            : call.callerID;
          
          const otherSocketID = this.connectedUsers.get(otherUserID);
          
          if (otherSocketID) {
            this.io.to(otherSocketID).emit('call-ended', { 
              callID,
              endedBy: this.userSockets.get(socket.id)?.userID
            });
          }
          
          // Remove call from active calls
          this.activeCalls.delete(callID);
          
          console.log(`Call ended: ${callID}`);
        }
      });
      
      // Handle disconnection
      socket.on('disconnect', () => {
        const userInfo = this.userSockets.get(socket.id);
        
        if (userInfo) {
          const { userID, userType } = userInfo;
          
          // Remove user from connected users
          this.connectedUsers.delete(userID);
          this.userSockets.delete(socket.id);
          
          // End any active calls for this user
          for (const [callID, call] of this.activeCalls.entries()) {
            if (call.callerID === userID || call.calleeID === userID) {
              const otherUserID = call.callerID === userID ? call.calleeID : call.callerID;
              const otherSocketID = this.connectedUsers.get(otherUserID);
              
              if (otherSocketID) {
                this.io.to(otherSocketID).emit('call-ended', { 
                  callID,
                  reason: 'User disconnected'
                });
              }
              
              this.activeCalls.delete(callID);
            }
          }
          
          // Notify others about user offline status
          socket.broadcast.emit('user-status-changed', { 
            userID, 
            status: 'offline', 
            userType 
          });
          
          console.log(`User disconnected: ${userID} (${userType})`);
        }
      });
    });
  }
  
  // Get connected users count
  getConnectedUsersCount() {
    return this.connectedUsers.size;
  }
  
  // Get active calls count
  getActiveCallsCount() {
    return this.activeCalls.size;
  }
  
  // Get user status
  getUserStatus(userID) {
    return this.connectedUsers.has(userID) ? 'online' : 'offline';
  }
}

module.exports = SignalingServer;
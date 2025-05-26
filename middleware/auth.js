// middleware/auth.js
const jwt = require("jsonwebtoken");

module.exports = (requiredRole) => {
  return (req, res, next) => {
    try {
      const token = req.header("Authorization")?.replace("Bearer ", "");

      if (!token) {
        return res.status(401).json({ error: "No token provided" });
      }

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "your-secret-key"
      );

      if (requiredRole && decoded.role !== requiredRole) {
        return res.status(403).json({ error: "Access denied" });
      }

      req.userId = decoded.id;
      req.userRole = decoded.role;
      next();
    } catch (error) {
      res.status(401).json({ error: "Invalid token" });
    }
  };
};

module.exports = (req, res, next) => {

  if (
    req.user.role !== "admin" &&
    req.user.role !== "founder"
  ) {
    return res.status(403).json({
      error: "دسترسی ادمین لازم است"
    });
  }

  next();
};
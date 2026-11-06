const { HttpError } = require("../utils/httpError");

function notFound(req, res) {
  res.status(404).json({ success: false, message: "Not found" });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ success: false, message: err.message, code: err.code });
  }
  // Malformed JSON body.
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, message: "Request body must be valid JSON." });
  }
  console.error(err);
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

module.exports = { notFound, errorHandler };

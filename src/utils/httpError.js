// An error with an HTTP status and a message that is safe to show the client.
class HttpError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details; // extra fields safe to send, e.g. { retryAfter }
  }
}

module.exports = { HttpError };
